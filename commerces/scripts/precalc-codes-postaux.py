#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
precalc-codes-postaux.py — Génère `data/codes-postaux-precalc.json` pour le
simulateur commerçants (equiprix.fr/commerces).

Sources (placées dans `data/source/`, non servies côté navigateur) :
  - `communes-2021.csv` : export CSV de l'onglet « France 2021 + communes 2021 »
    (gid=261338767) du tableur de référence equiprix : une ligne par commune
    (CODGEO, LIBGEO, NBMEN21, NBPERS21, quartiles, déciles) + colonne
    « Code postal » + ligne « France métropolitaine » (bornes nationales) ;
  - `codes-postaux.json` : base data.gouv.fr « Codes postaux » (ressource
    unpkg du package `codes-postaux`, format « full »), pour compléter le
    mapping CODGEO ↔ code postal des communes absentes du CSV.

Méthode (cf. ticket) :
  1. Parts par commune : les ménages sont supposés uniformément répartis
     dans chaque intervalle inter-décile local, puis découpés aux bornes
     nationales 2021 (D2 = 13 200 €, D4 = 19 960 €, D6 = 26 080 €).
  2. Agrégation par code postal : nbMenages sommé, parts pondérées par le
     nombre de ménages de chaque commune.
  3. Communes sans données Filosofi : ménages répartis selon la moyenne
     nationale (20 % / 20 % / 20 % / 40 %). Si l'agrégat n'a aucune donnée,
     `donneesDispo: false` et valeurs nulles.

Usage :
    python3 scripts/precalc-codes-postaux.py
    python3 scripts/precalc-codes-postaux.py --csv data/source/communes-2021.csv \
        --cp data/source/codes-postaux.json -o data/codes-postaux-precalc.json
"""
import argparse
import csv
import json
import sys
import unicodedata
from pathlib import Path

# Racine du dossier commerces/ (indépendamment du répertoire d'exécution)
RACINE = Path(__file__).resolve().parent.parent

# Bornes nationales 2021 de secours (D2/D4/D6 France métropolitaine) si la
# ligne « France métropolitaine » est absente du CSV
BORNES_NAT_DEFAUT = {"D2": 13200, "D4": 19960, "D6": 26080}

INF = 10 ** 9  # borne supérieure fictive (comme le tableur « 1,00E+09 »)

# Personnes par ménage en France métropolitaine 2021 (62,6 M / 28,3 M) :
# estimation des ménages des communes où NBMEN21 n'est pas publié
PERS_PAR_MENAGE = 2.21

# Parts nationales par défaut (définition des catégories equiprix :
# 20 % les plus bas, 20-40 %, 40-60 %, 40 % les plus hauts)
PARTS_NATIONALES = {"rouge": 0.20, "orange": 0.20, "jaune": 0.20, "verte": 0.40}

# Tranches de population du découpage fin (déciles + quartiles) :
# (borne inf, borne sup, part de population) — total = 100 %
TRANCHES_FIN = [
    (None, "D1", 0.10), ("D1", "D2", 0.10), ("D2", "Q1", 0.05),
    ("Q1", "D3", 0.05), ("D3", "D4", 0.10), ("D4", "Q2", 0.10),
    ("Q2", "D6", 0.10), ("D6", "D7", 0.10), ("D7", "D8", 0.10),
    ("D8", "D9", 0.10), ("D9", None, 0.10),
]
# Découpages de repli pour les communes aux données partielles
TRANCHES_QUARTILES = [(None, "Q1", 0.25), ("Q1", "Q2", 0.25), ("Q2", "Q3", 0.25), ("Q3", None, 0.25)]
TRANCHES_Q1Q3 = [(None, "Q1", 0.25), ("Q1", "Q3", 0.50), ("Q3", None, 0.25)]
TRANCHES_MEDIANE = [(None, "Q2", 0.50), ("Q2", None, 0.50)]

CATEGORIES = ["rouge", "orange", "jaune", "verte"]


def en_nombre(cellule):
    """Convertit une cellule CSV en nombre (virgule décimale, espaces fines), ou None."""
    if cellule is None:
        return None
    texte = str(cellule).replace("\n", "").replace("\r", "")
    for sep in (" ", " ", " ", "⁠"):
        texte = texte.replace(sep, "")
    texte = texte.strip().replace(",", ".")
    if not texte or texte.lower() in {"s", "nd", "n.d.", "-", "–"}:
        return None
    try:
        return float(texte)
    except ValueError:
        return None


def lire_communes_csv(chemin):
    """
    Lit le CSV Filosofi 2021. Retourne (bornes_nationales, communes) :
    - bornes_nationales : {"D2": …, "D4": …, "D6": …} depuis la ligne
      « France métropolitaine » ;
    - communes : {codgeo: {nom, cp, nbMenages, nbPersonnes, bornes, aDonnees}}
    """
    with open(chemin, encoding="utf-8-sig", newline="") as f:
        lignes = list(csv.reader(f))

    # Ligne d'en-tête du bloc communal : contient CODGEO, LIBGEO et Code postal
    idx_entete = None
    for i, ligne in enumerate(lignes):
        if "CODGEO" in ligne and "LIBGEO" in ligne:
            idx_entete = i
            break
    if idx_entete is None:
        sys.exit("Erreur : en-tête communal (CODGEO/LIBGEO) introuvable dans le CSV.")
    entete = lignes[idx_entete]
    col = {nom: entete.index(nom) for nom in entete if nom}

    def champ(ligne, nom):
        j = col.get(nom)
        return ligne[j] if j is not None and j < len(ligne) else ""

    # Colonnes des bornes du bloc national : en-tête libellés (mêmes positions
    # que le bloc communal, sans la colonne « Code postal » en tête).
    idx_entete_nat = None
    for i in range(idx_entete):
        if "2ᵉ décile (€)" in lignes[i] and "CODGEO" not in lignes[i]:
            idx_entete_nat = i
            break
    if idx_entete_nat is None:
        sys.exit("Erreur : en-tête du bloc national (libellés déciles) introuvable.")
    entete_nat = lignes[idx_entete_nat]
    col_nat = {nom: entete_nat.index(nom) for nom in entete_nat if nom}
    sources_nat_col = {cle: col_nat[nom] for cle, nom in
                       (("D2", "2ᵉ décile (€)"), ("D4", "4ᵉ décile (€)"), ("D6", "6ᵉ décile (€)"))}

    bornes_nationales = dict(BORNES_NAT_DEFAUT)
    bornes_nat_vues = set()
    communes = {}
    for ligne in lignes:
        if len(ligne) <= max(col.values()):
            continue
        codgeo = champ(ligne, "CODGEO").strip()
        # Ligne « France métropolitaine » (bloc national, code « 1 » ou libellé)
        libelle = champ(ligne, "LIBGEO").strip()
        if codgeo == "1" or libelle.lower().startswith("france m"):
            # Bornes nationales lues aux colonnes du bloc national (le bloc
            # communal est décalé d'une colonne). Ne retenir que la première
            # occurrence (millésime 2021, pas la ligne « données 2023 »).
            for cle, j in sources_nat_col.items():
                val = en_nombre(ligne[j]) if j < len(ligne) else None
                if val is not None and cle not in bornes_nat_vues:
                    bornes_nationales[cle] = val
                    bornes_nat_vues.add(cle)
            continue
        # La ligne « données 2023 » porte les bornes du millésime 2023 :
        # hors périmètre (les catégories equiprix restent ancrées sur 2021)
        if libelle.strip().lower() == "données 2023":
            continue
        # Lignes communales : CODGEO à 5 chiffres
        if not (codgeo.isdigit() and len(codgeo) == 5):
            continue
        bornes = {}
        for cle, source in (("D1", "D121"), ("D2", "D221"), ("Q1", "Q121"),
                            ("D3", "D321"), ("D4", "D421"), ("Q2", "Q221"),
                            ("D6", "D621"), ("D7", "D721"), ("D8", "D821"),
                            ("D9", "D921"), ("Q3", "Q321")):
            val = en_nombre(champ(ligne, source))
            if val is not None:
                bornes[cle] = val
        nb_men = en_nombre(champ(ligne, "NBMEN21"))
        nb_pers = en_nombre(champ(ligne, "NBPERS21"))
        cp_brut = champ(ligne, "Code postal").strip() or ligne[0].strip() if ligne else ""
        communes[codgeo] = {
            "nom": libelle,
            "cp": cp_brut,
            "nbMenages": nb_men,
            "nbPersonnes": nb_pers,
            "bornes": bornes,
            "aDonnees": bool(bornes),
        }
    if len(bornes_nat_vues) < 3:
        print("ATTENTION : ligne « France métropolitaine » 2021 non reconnue, "
              "bornes nationales par défaut utilisées : "
              f"{sorted(BORNES_NAT_DEFAUT - bornes_nat_vues)}", file=sys.stderr)
    return bornes_nationales, communes


def lire_base_cp(chemin):
    """
    Lit la base data.gouv.fr (package codes-postaux, format full).
    Retourne {cp: {codgeo: nomCommune}} en ne gardant que les codes postaux
    de commune (codeVoie « XXXX »), dédupliqués.
    """
    with open(chemin, encoding="utf-8") as f:
        entrees = json.load(f)
    cp_vers_communes = {}
    for e in entrees:
        if e.get("codeVoie") != "XXXX":
            continue
        cp = str(e.get("codePostal", "")).strip()
        codgeo = str(e.get("codeCommune", "")).strip()
        if not (cp.isdigit() and codgeo.isdigit() and len(codgeo) == 5):
            continue
        cp_vers_communes.setdefault(cp, {})[codgeo] = e.get("nomCommune", "")
    return cp_vers_communes


def decouper(bornes_locales, tranches, bornes_nat):
    """
    Répartit les ménages d'une commune dans les 4 catégories equiprix.
    Hypothèse : répartition uniforme dans chaque tranche [borneInf, borneSup].
    """
    parts = {c: 0.0 for c in CATEGORIES}
    limites = [0.0, bornes_nat["D2"], bornes_nat["D4"], bornes_nat["D6"], float(INF)]
    for lo_cle, hi_cle, poids in tranches:
        lo = bornes_locales.get(lo_cle, 0.0) if lo_cle else 0.0
        hi = bornes_locales.get(hi_cle, float(INF)) if hi_cle else float(INF)
        if hi is None or lo is None or hi <= lo:
            continue
        for j, cat in enumerate(CATEGORIES):
            chev = max(0.0, min(hi, limites[j + 1]) - max(lo, limites[j])) / (hi - lo)
            parts[cat] += poids * chev
    return parts


def parts_commune(commune, bornes_nat):
    """Parts rouge/orange/jaune/verte d'une commune selon ses données disponibles."""
    b = commune["bornes"]
    if all(k in b for k in ("D1", "D2", "Q1", "D3", "D4", "Q2", "D6", "D7", "D8", "D9")):
        return decouper(b, TRANCHES_FIN, bornes_nat), True
    if all(k in b for k in ("Q1", "Q2", "Q3")):
        return decouper(b, TRANCHES_QUARTILES, bornes_nat), True
    if "Q2" in b:
        return decouper(b, TRANCHES_MEDIANE, bornes_nat), True
    if "Q1" in b and "Q3" in b:
        return decouper(b, TRANCHES_Q1Q3, bornes_nat), True
    # Pas de données Filosofi : répartition selon la moyenne nationale
    return dict(PARTS_NATIONALES), False


def ménages_estimes(commune):
    """Nombre de ménages : NBMEN21 publié, sinon NBPERS21 / 2,21, sinon 0."""
    if commune["nbMenages"]:
        return int(round(commune["nbMenages"]))
    if commune["nbPersonnes"]:
        return int(round(commune["nbPersonnes"] / PERS_PAR_MENAGE))
    return 0


def construire(communes, cp_vers_communes, bornes_nat):
    """Agrège les communes par code postal. Retourne le dict final indexé par CP."""
    # Compléter le mapping CP ↔ CODGEO avec la base data.gouv.fr
    cp_local = {}
    for codgeo, commune in communes.items():
        if commune["cp"]:
            cp_local.setdefault(commune["cp"], {})[codgeo] = commune
    for cp, liste in cp_vers_communes.items():
        cible = cp_local.setdefault(cp, {})
        for codgeo, nom in liste.items():
            if codgeo not in cible:
                # Commune absente du CSV Filosofi : pas de données
                cible[codgeo] = {
                    "nom": nom, "cp": cp, "nbMenages": None,
                    "nbPersonnes": None, "bornes": {}, "aDonnees": False,
                }

    resultat = {}
    for cp, liste in cp_local.items():
        lignes = []
        for codgeo, commune in liste.items():
            parts, a_donnees = parts_commune(commune, bornes_nat)
            lignes.append({
                "nom": commune["nom"] or codgeo,
                "nbMenages": ménages_estimes(commune),
                "parts": parts,
                "aDonnees": a_donnees,
            })
        lignes.sort(key=lambda l: l["nbMenages"], reverse=True)
        total_menages = sum(l["nbMenages"] for l in lignes)
        # Pondération des parts par le nombre de ménages (communes sans
        # données Filosofi incluses, réparties selon la moyenne nationale)
        poids = sum(l["nbMenages"] for l in lignes if l["aDonnees"])
        if poids > 0:
            parts_cp = {c: 0.0 for c in CATEGORIES}
            for l in lignes:
                if not l["aDonnees"]:
                    continue
                for c in CATEGORIES:
                    parts_cp[c] += l["nbMenages"] * l["parts"][c]
            for c in CATEGORIES:
                parts_cp[c] /= poids
            donnees_dispo = True
        else:
            parts_cp = None
            donnees_dispo = False

        entree = {
            "communes": [l["nom"] for l in lignes],
            "nbMenages": total_menages if donnees_dispo else None,
            "parts": None,
            "donneesDispo": donnees_dispo,
        }
        if donnees_dispo:
            # Arrondi à 3 décimales ; la verte absorbe le complément (Σ = 100 %)
            r = round(parts_cp["rouge"], 3)
            o = round(parts_cp["orange"], 3)
            j = round(parts_cp["jaune"], 3)
            entree["parts"] = {
                "rouge": r, "orange": o, "jaune": j,
                "verte": round(1.0 - r - o - j, 3),
            }
        resultat[cp] = entree
    return resultat


def main():
    parseur = argparse.ArgumentParser(description="Précalcule la base codes postaux equiprix.")
    parseur.add_argument("--csv", default=str(RACINE / "data/source/communes-2021.csv"),
                         help="Export CSV de l'onglet Filosofi 2021 + communes")
    parseur.add_argument("--cp", default=str(RACINE / "data/source/codes-postaux.json"),
                         help="Base data.gouv.fr des codes postaux (format full)")
    parseur.add_argument("-o", "--output", default=str(RACINE / "data/codes-postaux-precalc.json"),
                         help="Fichier JSON de sortie")
    args = parseur.parse_args()

    bornes_nat, communes = lire_communes_csv(args.csv)
    cp_vers_communes = lire_base_cp(args.cp)
    resultat = construire(communes, cp_vers_communes, bornes_nat)

    sortie = Path(args.output)
    sortie.write_text(json.dumps(resultat, ensure_ascii=False, separators=(",", ":")) + "\n",
                      encoding="utf-8")

    # Contrôle qualité : cas de référence Conflans-Sainte-Honorine (78700)
    ref = resultat.get("78700")
    if ref:
        attendu = {"rouge": 0.153, "orange": 0.132, "jaune": 0.156, "verte": 0.559}
        ok = (ref["nbMenages"] == 14515 and ref["donneesDispo"]
              and all(abs(ref["parts"][c] - attendu[c]) < 0.0005 for c in CATEGORIES))
        print(f"Contrôle 78700 : {ref['communes'][0]!r}, {ref['nbMenages']} ménages, "
              f"parts {ref['parts']} -> {'OK' if ok else 'ÉCART !'}")

    avec_donnees = sum(1 for e in resultat.values() if e["donneesDispo"])
    print(f"OK : {len(resultat)} codes postaux ({avec_donnees} avec données, "
          f"{len(resultat) - avec_donnees} sans) -> {sortie}")
    print(f"Communes en entrée : {len(communes)} ; taille brute : "
          f"{sortie.stat().st_size / 1024:.0f} Ko")


if __name__ == "__main__":
    main()
