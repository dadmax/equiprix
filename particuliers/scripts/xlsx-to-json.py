#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
xlsx-to-json.py — Convertit le fichier Insee Filosofi (xlsx ou csv) en
`data/niveaux-vie-dep-2023.json` pour le simulateur equiprix.

Le fichier source est le téléchargement Insee « Revenus et pauvreté des ménages
en 2023 - Tous les niveaux géographiques » (ou l'export CSV du tableur interne),
contenant pour chaque territoire : D1 à D9 (médiane = D5), Q1 et Q3 du niveau de vie.

Nettoie : lignes d'en-tête à ignorer, espaces fines insécables (U+00AF / U+202F)
et espaces insécables (U+00A0) comme séparateurs de milliers, virgules décimales,
sauts de ligne parasites dans les cellules (ex. « Aveyron\\n », « 24 59\\n0 »).

Usage :
    python3 xlsx-to-json.py data/source/fichier.xlsx
    python3 xlsx-to-json.py data/source/fichier.csv
    python3 xlsx-to-json.py data/source/fichier.xlsx -o data/niveaux-vie-dep-2023.json

Dépendances (xlsx uniquement) : pip install openpyxl
"""
import argparse
import csv
import json
import re
import sys
from pathlib import Path

# Colonnes du JSON, avec les noms de variables Insee (Filosofi) en synonymes.
CHAMPS = {
    "d1": ["d1", "d1_sl", "1er décile"],
    "d2": ["d2", "d2_sl", "2e décile"],
    "d3": ["d3", "d3_sl", "3e décile"],
    "d4": ["d4", "d4_sl", "4e décile"],
    "d5": ["d5", "d5_sl", "médiane", "med_sl", "mediane"],
    "d6": ["d6", "d6_sl", "6e décile"],
    "d7": ["d7", "d7_sl", "7e décile"],
    "d8": ["d8", "d8_sl", "8e décile"],
    "d9": ["d9", "d9_sl", "9e décile"],
    "q1": ["q1", "q1_sl", "1er quartile"],
    "q3": ["q3", "q3_sl", "3e quartile"],
}
CODES_NIVEAUX_GEO_DEP = {"dep", "departement", "dép", "département", "DEP"}
CODE_FRANCE = "1"  # Code « France métropolitaine » dans les fichiers Insee
SEPARATEURS_MILLIERS = re.compile(r"[\s\u00A0\u00AF\u202F\u2060]")


def nettoyer(cellule):
    """Retire sauts de ligne, espaces insécables, virgule décimale -> point."""
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
    return str(cellule).replace("\n", "").replace("\r", "").strip()


def en_nombre(cellule):
    """Convertit une cellule nettoyée en entier d'euros (arrondi), ou None."""
    texte = nettoyer(cellule)
    if not texte or texte in {"-", "–", "nd", "n.d."}:
        return None
    try:
        return int(round(float(texte)))
    except ValueError:
        return None


def normaliser_entete(nom):
    """Minuscule, sans accents ni espaces multiples, pour la correspondance."""
    texte = nettoyer(nom).lower()
    texte = texte.replace(" ", "_")
    for accent, simple in [("é", "e"), ("è", "e"), ("ê", "e")]:
        texte = texte.replace(accent, simple)
    return texte


def trouver_champ(entete_norm):
    """Retourne la clé de CHAMPS correspondant à un en-tête, sinon None."""
    for cle, synonymes in CHAMPS.items():
        if entete_norm in synonymes:
            return cle
    return None


def lire_lignes(chemin):
    """Lit un xlsx ou un csv et retourne une liste de lignes (listes de cellules)."""
    if chemin.suffix.lower() in {".xlsx", ".xlsm", ".xls"}:
        import openpyxl
        classeur = openpyxl.load_workbook(chemin, data_only=True)
        feuille = classeur.active
        lignes = []
        for ligne in feuille.iter_rows(values_only=True):
            lignes.append(list(ligne))
        return lignes
    # CSV : détecte le séparateur (point-virgule le plus fréquent, sinon tabulation)
    with open(chemin, encoding="utf-8-sig", newline="") as fichier:
        texte = fichier.read()
    delimiteur = ";" if texte.count(";") >= texte.count("\t") else "\t"

    if '"' in texte:
        # CSV quoté : csv.reader gère nativement les sauts de ligne dans les cellules
        return [ligne for ligne in csv.reader(texte.splitlines(), delimiter=delimiteur)]

    # CSV non quoté : rejoint les lignes physiques dont le saut de ligne
    # était parasite à l’intérieur d’une cellule (ex. « Aveyron\n », « 24 59\n0 »).
    code_debut = re.compile(r'^(1|\d{2}|\d{3}|2A|2B)(?:[;\t]|$)')
    lignes_rejointes = []
    precedent_enregistrement = False
    for physique in texte.splitlines():
        if not physique.strip():
            continue
        est_enregistrement = code_debut.match(physique.strip()) is not None
        if precedent_enregistrement and not est_enregistrement:
            lignes_rejointes[-1] += physique  # concaténation directe : le saut de ligne était dans la cellule
        else:
            lignes_rejointes.append(physique)
        precedent_enregistrement = est_enregistrement or (precedent_enregistrement and not est_enregistrement)
    return [ligne for ligne in csv.reader(lignes_rejointes, delimiter=delimiteur)]


def parse_lignes(lignes):
    """Détecte l'en-tête, ignore les lignes de titre, et retourne france + départements."""
    france = None
    departements = []
    index_champs = None
    index_code = index_nom = index_geo = None

    for ligne in lignes:
        cellules = [nettoyer(c) for c in ligne]
        if not any(cellules):
            continue
        en_tetes = [normaliser_entete(c) for c in cellules]

        # Détection de la ligne d'en-tête : au moins D1 et D9 (ou leurs variantes)
        cles = [trouver_champ(h) for h in en_tetes]
        if index_champs is None and "d1" in cles and "d9" in cles:
            index_champs = cles
            for i, h in enumerate(en_tetes):
                if h in {"geo", "codgeo", "code", "code_geo", "code_dep", "dep", "code_departement"} and index_code is None:
                    index_code = i
                elif h in {"libelle", "libelle_geo", "libgeo", "libelle_departement", "nom", "niveau_geo", "geo_object"} and index_nom is None:
                    index_nom = i
                elif h in {"geo_object", "niveau_geo", "nivgeo"} and index_geo is None:
                    index_geo = i
            continue
        if index_champs is None:
            continue  # lignes d'en-tête à ignorer (4 lignes de titre Insee typiques)

        # Extraction des valeurs
        valeurs = {}
        for i, cle in enumerate(index_champs):
            if cle and valeurs.get(cle) is None:
                nombre = en_nombre(ligne[i]) if i < len(ligne) else None
                if nombre is not None:
                    valeurs[cle] = nombre

        cellules_lib = [nettoyer_libelle(c) for c in ligne]
        code_brut = cellules_lib[index_code].strip() if index_code is not None and index_code < len(cellules_lib) else ""
        if not code_brut:
            continue

        # Ligne France : code « 1 » exact (pas « 01 » = Ain) ou libellé contenant « France »
        libelle_geo = cellules_lib[index_nom].lower() if index_nom is not None and index_nom < len(cellules_lib) else ""
        if code_brut in {"1", "FRA", "FR", "FX"} or "france" in libelle_geo:
            if all(cle in valeurs for cle in CHAMPS):
                france = valeurs
            continue

        # Départements : code à 2-3 caractères numériques (01-95, 971-976, 2A, 2B)
        if not re.fullmatch(r"\d{2}|\d{3}|2A|2B", code_brut):
            continue

        nom = cellules_lib[index_nom] if index_nom is not None and index_nom < len(cellules_lib) else ""
        if all(cle in valeurs for cle in CHAMPS):
            entree = {"code": code_brut, "nom": nom}
            entree.update({cle: valeurs[cle] for cle in CHAMPS})
            departements.append(entree)

    return france, departements


def main():
    parseur = argparse.ArgumentParser(description="Convertit le fichier Insee Filosofi en JSON equiprix.")
    parseur.add_argument("source", help="Fichier source .xlsx ou .csv (Insee Filosofi)")
    parseur.add_argument("-o", "--output", default=None, help="Fichier JSON de sortie")
    args = parseur.parse_args()

    chemin = Path(args.source)
    if not chemin.exists():
        sys.exit(f"Erreur : fichier introuvable : {chemin}")

    sortie = Path(args.output) if args.output else chemin.parent.parent / "niveaux-vie-dep-2023.json"

    lignes = lire_lignes(chemin)
    france, departements = parse_lignes(lignes)

    if france is None:
        sys.exit("Erreur : ligne France introuvable (code « 1 » / libellé « France »).")
    if len(departements) == 0:
        sys.exit("Erreur : aucun département trouvé (vérifiez les en-têtes D1_SL / D9_SL / GEO).")

    departements.sort(key=lambda d: d["code"])
    resultat = {
        "meta": {
            "source": "Insee, Filosofi 2023 (dispositif Filosofi 2)",
            "zone": "France métropolitaine et La Réunion",
            "referentielPauvrete": "Seuil de pauvreté à 60 % de la médiane métropolitaine",
        },
        "france": france,
        "departements": departements,
    }
    sortie.write_text(json.dumps(resultat, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"OK : {len(departements)} départements + France -> {sortie}")
    if len(departements) != 101:
        print(f"ATTENTION : {len(departements)} départements trouvés (101 attendus, métropole + 2A/2B + 974).", file=sys.stderr)


if __name__ == "__main__":
    main()
