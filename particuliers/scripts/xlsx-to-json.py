#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
xlsx-to-json.py — Convertit le fichier Insee Filosofi (xlsx ou csv) en
`data/niveaux-vie-dep-2023.json` pour le simulateur equiprix.

Fichier source attendu : téléchargement Insee « FILOSOFI_CC_2023_FR » (ou
l'export CSV équivalent), contenant pour chaque territoire le niveau de vie
médian, les déciles D1 à D9 (hors D5 = médiane) et les quartiles Q1 et Q3.

Formats reconnus :
  - xlsx multi-onglets Insee : onglets « FRANCE » (ligne FM) et « DEP » ;
  - xlsx mono-onglet (onglet actif) ;
  - csv.

Nettoie : lignes d'en-tête à ignorer, espaces fines insécables (U+00AF /
U+202F) et insécables (U+00A0) comme séparateurs de milliers, virgules
décimales, sauts de ligne parasites dans les cellules (ex. « Aveyron\\n »).

Usage :
    python3 xlsx-to-json.py data/source/FILOSOFI_CC_2023_FR.xlsx
    python3 scripts/xlsx-to-json.py data/source/fichier.csv -o data/out.json

Dépendances (xlsx uniquement) : pip install openpyxl
"""
import argparse
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

# Correspondance en-tête -> clé du JSON. Les libellés complets Insee
# (« 1er décile du niveau de vie (en euros) ») et les noms de variables
# (D1_SL) sont tous reconnus.
PATTERNS_CHAMPS = [
    ("d1", [r"^d1(_sl)?$", r"^1er_decile"]),
    ("d2", [r"^d2(_sl)?$", r"^2e_decile"]),
    ("d3", [r"^d3(_sl)?$", r"^3e_decile"]),
    ("d4", [r"^d4(_sl)?$", r"^4e_decile"]),
    ("d5", [r"^d5(_sl)?$", r"^mediane?", r"^niveau_de_vie_median"]),
    ("d6", [r"^d6(_sl)?$", r"^6e_decile"]),
    ("d7", [r"^d7(_sl)?$", r"^7e_decile"]),
    ("d8", [r"^d8(_sl)?$", r"^8e_decile"]),
    ("d9", [r"^d9(_sl)?$", r"^9e_decile"]),
    ("q1", [r"^q1(_sl)?$", r"^1er_quartile"]),
    ("q3", [r"^q3(_sl)?$", r"^3e_quartile"]),
]

SEPARATEURS_MILLIERS = re.compile(r"[\s\u00A0\u00AF\u202F\u2060]")
CODE_DEPARTEMENT = re.compile(r"^(\d{2}|\d{3}|2A|2B)$")
NB_DEPARTEMENTS_ATTENDUS = 97  # métropole (96, y c. 2A/2B) + La Réunion (974)


def sans_accents(texte):
    """Retire accents et signes diacritiques (utilisé pour les en-têtes)."""
    return "".join(c for c in unicodedata.normalize("NFD", texte) if not unicodedata.combining(c))


def nettoyer(cellule):
    """Nettoie une valeur : sauts de ligne, espaces insécables, virgule -> point."""
    if cellule is None:
        return ""
    texte = str(cellule).replace("\n", "").replace("\r", "").strip()
    texte = SEPARATEURS_MILLIERS.sub("", texte)
    if "," in texte:
        texte = texte.replace(",", ".")
    return texte.strip()


def nettoyer_libelle(cellule):
    """Nettoie un libellé (nom de territoire) en préservant les espaces."""
    if cellule is None:
        return ""
    return str(cellule).replace("\n", " ").replace("\r", " ").strip()


def normaliser_entete(nom):
    """Minuscule, sans accents, underscore pour les espaces."""
    texte = sans_accents(nettoyer_libelle(nom).lower())
    texte = re.sub(r"[^a-z0-9]+", "_", texte)
    return texte.strip("_")


def trouver_champ(entete_norm):
    """Retourne la clé du JSON correspondant à un en-tête, sinon None."""
    for cle, motifs in PATTERNS_CHAMPS:
        if any(re.match(m, entete_norm) for m in motifs):
            return cle
    return None


def lire_onglets(chemin):
    """Retourne {nom d'onglet: lignes} pour un xlsx, ou {None: lignes} pour un csv."""
    if chemin.suffix.lower() not in {".xlsx", ".xlsm", ".xls"}:
        return {None: lire_csv(chemin)}
    import openpyxl
    classeur = openpyxl.load_workbook(chemin, data_only=True)
    onglets = {}
    for nom in classeur.sheetnames:
        feuille = classeur[nom]
        onglets[nom] = [list(ligne) for ligne in feuille.iter_rows(values_only=True)]
    return onglets


def lire_csv(chemin):
    """Lit un csv en gérant séparateur inconnu et sauts de ligne parasites."""
    texte = chemin.read_text(encoding="utf-8-sig")
    delimiteur = ";" if texte.count(";") >= texte.count("\t") else "\t"

    if '"' in texte:
        # CSV quoté : csv.reader gère les sauts de ligne dans les cellules
        return [ligne for ligne in csv.reader(texte.splitlines(), delimiter=delimiteur)]

    # CSV non quoté : rejoint les lignes physiques dont le saut de ligne était
    # parasite à l'intérieur d'une cellule (ex. « Aveyron\n », « 24 59\n0 »)
    code_debut = re.compile(r"^(1|\d{2}|\d{3}|2A|2B)(?:[;\t]|$)")
    lignes_rejointes = []
    precedent_enregistrement = False
    for physique in texte.splitlines():
        if not physique.strip():
            continue
        est_enregistrement = code_debut.match(physique.strip()) is not None
        if precedent_enregistrement and not est_enregistrement:
            lignes_rejointes[-1] += physique
        else:
            lignes_rejointes.append(physique)
        precedent_enregistrement = est_enregistrement or (precedent_enregistrement and not est_enregistrement)
    return [ligne for ligne in csv.reader(lignes_rejointes, delimiter=delimiteur)]


def parse_lignes(lignes):
    """Détecte l'en-tête puis retourne (france, departements) de cet onglet."""
    france = None
    departements = []
    index_champs = None
    index_code = index_nom = None

    lignes_utiles = [l for l in lignes if any(nettoyer_libelle(c) for c in l)]
    for num, ligne in enumerate(lignes_utiles):
        cellules_lib = [nettoyer_libelle(c) for c in ligne]

        if index_champs is None:
            # Détection de la ligne d'en-tête : au moins D1 et D9.
            # GEO / Géographie peuvent être sur cette ligne (csv) ou sur la
            # suivante (xlsx Insee) : on fusionne les deux lignes de détection.
            cles = [trouver_champ(normaliser_entete(c)) for c in cellules_lib]
            if "d1" in cles and "d9" in cles:
                ligne_suivante = lignes_utiles[num + 1] if num + 1 < len(lignes_utiles) else []
                for source_ligne in (ligne, ligne_suivante):
                    for i, c in enumerate(source_ligne):
                        norm = normaliser_entete(c)
                        if index_code is None and norm in {"geo", "codgeo", "code", "code_geo", "code_dep"}:
                            index_code = i
                        elif index_nom is None and norm in {"libgeo", "libelle", "libelle_geo", "nom", "geographie"}:
                            index_nom = i
                # La ligne suivante peut n'être qu'un complément d'en-tête : si
                # elle ne contient ni code ni nom, on la saute.
                if index_code is not None and not CODE_DEPARTEMENT.match(
                    nettoyer_libelle(ligne_suivante[index_code]) if ligne_suivante and index_code < len(ligne_suivante) else ""
                ) and "france" not in (
                    nettoyer_libelle(ligne_suivante[index_nom]).lower() if ligne_suivante and index_nom is not None and index_nom < len(ligne_suivante) else ""
                ):
                    lignes_utiles = lignes_utiles[:num + 1] + lignes_utiles[num + 2:]
                index_champs = cles
                continue
            continue  # lignes de titre à ignorer

        # Extraction des bornes
        valeurs = {}
        for i, cle in enumerate(index_champs):
            if cle and cle not in valeurs:
                nombre = en_nombre(ligne[i]) if i < len(ligne) else None
                if nombre is not None:
                    valeurs[cle] = nombre

        code_brut = cellules_lib[index_code] if index_code is not None and index_code < len(cellules_lib) else ""
        if not code_brut:
            continue

        libelle_geo = cellules_lib[index_nom].lower() if index_nom is not None and index_nom < len(cellules_lib) else ""
        complet = all(cle in valeurs for cle, _ in PATTERNS_CHAMPS)

        # Ligne France : code « FM »/« 1 » exact (pas « 01 » = Ain) ou libellé France
        if code_brut in {"1", "FM", "FRA", "FR", "FX"} or "france" in libelle_geo:
            if complet:
                france = valeurs
            continue

        # Départements : codes 01-95, 971-976, 2A, 2B
        if not CODE_DEPARTEMENT.match(code_brut):
            continue
        if complet:
            entree = {"code": code_brut, "nom": cellules_lib[index_nom] if index_nom is not None and index_nom < len(cellules_lib) else ""}
            entree.update({cle: valeurs[cle] for cle, _ in PATTERNS_CHAMPS})
            departements.append(entree)

    return france, departements


def en_nombre(cellule):
    """Convertit une cellule en entier d'euros (arrondi), ou None."""
    if isinstance(cellule, (int, float)):
        return int(round(float(cellule)))
    texte = nettoyer(cellule)
    if not texte or texte in {"-", "–", "nd", "n.d.", "s"}:
        return None
    try:
        return int(round(float(texte)))
    except ValueError:
        return None


def convertir(chemin):
    """Point d'entrée : retourne le dictionnaire JSON complet."""
    onglets = lire_onglets(chemin)

    # xlsx Insee multi-onglets : FRANCE (ligne FM) + DEP ; sinon onglet actif/csv
    if "FRANCE" in onglets and "DEP" in onglets:
        sources = ["FRANCE", "DEP"]
    else:
        sources = list(onglets.keys())[:1]

    france = None
    departements = []
    for nom in sources:
        f, d = parse_lignes(onglets[nom])
        if f is not None:
            france = f
        departements.extend(d)

    if france is None:
        sys.exit("Erreur : ligne France introuvable (code « FM » / « 1 » / libellé « France »).")
    if not departements:
        sys.exit("Erreur : aucun département trouvé (vérifiez les en-têtes déciles/quartiles et la colonne GEO).")

    # Dédoublonnage et tri par code
    vus = {}
    for dep in departements:
        vus.setdefault(dep["code"], dep)
    departements = sorted(vus.values(), key=lambda d: d["code"])

    return {
        "meta": {
            "source": "Insee, Filosofi 2023 (dispositif Filosofi 2)",
            "zone": "France métropolitaine et La Réunion",
            "referentielPauvrete": "Seuil de pauvreté à 60 % de la médiane métropolitaine",
        },
        "france": france,
        "departements": departements,
    }


def main():
    parseur = argparse.ArgumentParser(description="Convertit le fichier Insee Filosofi en JSON equiprix.")
    parseur.add_argument("source", help="Fichier source .xlsx ou .csv (Insee Filosofi)")
    parseur.add_argument("-o", "--output", default=None, help="Fichier JSON de sortie")
    args = parseur.parse_args()

    chemin = Path(args.source)
    if not chemin.exists():
        sys.exit(f"Erreur : fichier introuvable : {chemin}")

    sortie = Path(args.output) if args.output else chemin.parent.parent / "niveaux-vie-dep-2023.json"
    resultat = convertir(chemin)
    sortie.write_text(json.dumps(resultat, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    nb = len(resultat["departements"])
    print(f"OK : {nb} départements + France -> {sortie}")
    if nb != NB_DEPARTEMENTS_ATTENDUS:
        print(
            f"ATTENTION : {nb} départements trouvés ({NB_DEPARTEMENTS_ATTENDUS} attendus : "
            "métropole y c. 2A/2B, plus La Réunion 974).",
            file=sys.stderr,
        )


if __name__ == "__main__":
    main()
