#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Génère data/codes-postaux-precalc.json à partir des sources brutes.

Sources (déposées dans data/source/, non régénérées par ce script) :
  - filosofi-2021-communes.csv : données Filosofi 2021 (Insee, publication
    2024) par commune — export CSV de l'onglet « France 2021 et communes
    2021 » du tableur de référence equiprix. Colonnes : 0 = Code postal
    (pré-rempli pour information), 1 = CODGEO, 2 = LIBGEO, 3 = NBMEN21,
    4 = NBPERS21, puis quartiles et déciles du niveau de vie local.
  - laposte_hexasmal.csv : base officielle des codes postaux (La Poste,
    data.gouv.fr) — correspondance code INSEE <-> code postal, séparateur
    « ; », colonnes : code_commune_insee, nom_de_la_commune, code_postal…

Sortie : base indexée par code postal (~6 000 entrées), format compact :
  "78700": {"n": "Conflans-Sainte-Honorine", "m": 14515, "p": 36032,
            "r": [0.079, 0.107, 0.172, 0.642]}
  - n : nom d'affichage (première commune ; « + » si le CP couvre plusieurs
    communes, la liste complète est trop lourde — l'agrégat reste unique)
  - m : nombre de ménages fiscaux (somme des communes du CP)
  - p : nombre de personnes dans les ménages fiscaux (somme)
  - r : parts des ménages dans les catégories equiprix nationales
    [rouge, orange, jaune, verte] ; null si aucune donnée disponible
    (secret statistique). Le champ « données disponibles » du format
    long est implicite : r != null.

Précalcul des parts : distribution uniforme des ménages dans chaque
intervalle inter-décile local (10 % sous D1, 10 % D1-D2, 5 % D2-Q1,
5 % Q1-D3, 10 % D3-D4, 10 % D4-médiane, 10 % médiane-D6, 10 % D6-D7,
10 % D7-D8, 10 % D8-D9, 10 % au-dessus de D9), découpée aux bornes
nationales 2021 : rouge < 7 940 €, orange 7 940-15 190 €,
jaune 15 190-22 900 €, verte >= 22 900 €. Formule : part d'un intervalle
dans une catégorie = max(0, min(borneSup, borneNat) - max(borneInf,
borneNatPrécédente)) / (borneSup - borneInf) × part de population de
l'intervalle. Les déciles locaux ne figurent pas dans la base finale.

Agrégation par code postal : quand un CP couvre plusieurs communes (ou
qu'une commune est éclatée sur plusieurs CP), les ménages et personnes
sont sommés ; les parts de chaque commune sont pondérées par son nombre
de ménages.

Les revenus disponibles médians 2023 par catégorie (Filosofi 2023,
publication 2026 : rouge 13 200 €, orange 16 058 €, jaune 22 468 €,
verte 34 630 €) sont des constantes nationales identiques pour toutes
les communes : elles vivent dans le code du simulateur
(js/app.js), pas dans la base.

Réutilisation pour les millésimes futurs : remplacer le CSV Filosofi
dans data/source/ (mêmes colonnes) puis :
    python3 scripts/precalc-communes.py
"""

import csv
import gzip
import json
import os
import re
import sys
from collections import defaultdict

ICI = os.path.dirname(os.path.abspath(__file__))
DOSSIER_DATA = os.path.join(ICI, "..", "data")
FICHIER_FILOSOFI = os.path.join(DOSSIER_DATA, "source", "filosofi-2021-communes.csv")
FICHIER_LAPOSTE = os.path.join(DOSSIER_DATA, "source", "laposte_hexasmal.csv")
FICHIER_SORTIE = os.path.join(DOSSIER_DATA, "codes-postaux-precalc.json")

# Bornes nationales 2021 des catégories equiprix (Filosofi, publication 2024)
BORNES_NATIONALES = [7940.0, 15190.0, 22900.0]

# Intervalle inter-décile -> part de la population qu'il porte
# (distribution supposée uniforme à l'intérieur de chaque intervalle)
INTERVALLES = [
    ("D1", 0.10),   # sous D1
    ("D2", 0.10),   # D1-D2
    ("Q1", 0.05),   # D2-Q1
    ("D3", 0.05),   # Q1-D3
    ("D4", 0.10),   # D3-D4
    ("MED", 0.10),  # D4-médiane
    ("D6", 0.10),   # médiane-D6
    ("D7", 0.10),   # D6-D7
    ("D8", 0.10),   # D7-D8
    ("D9", 0.10),   # D8-D9
    (None, 0.10),   # au-dessus de D9
]
ORDRE_BORNES = ["D1", "D2", "Q1", "D3", "D4", "MED", "D6", "D7", "D8", "D9"]

SECRET = {"s", "nd", "", "-"}


def nombre(brut):
    """« 23 881,7 » -> 23881.7 ; None si secret statistique ou absent."""
    if brut is None:
        return None
    brut = brut.strip().replace("\u00a0", "").replace("\u202f", "").replace(" ", "")
    if brut.lower() in SECRET:
        return None
    try:
        return float(brut.replace(",", "."))
    except ValueError:
        return None


def lire_filosofi(chemin):
    """Lit le CSV Filosofi : { CODGEO : {nom, nbMenages, nbPersonnes, déciles} }."""
    communes = {}
    with open(chemin, newline="", encoding="utf-8") as f:
        for ligne in csv.reader(f):
            if len(ligne) < 19:
                continue
            codgeo = ligne[1].strip()
            if not re.fullmatch(r"\d{3,5}", codgeo) or not ligne[2].strip():
                continue
            deciles = {}
            # Colonnes : 7=Q1, 8=médiane, 11..18 = D1,D2,D3,D4,D6,D7,D8,D9
            for nom, col in zip(ORDRE_BORNES, [11, 12, 7, 13, 14, 8, 15, 16, 17, 18]):
                deciles[nom] = nombre(ligne[col])
            communes[codgeo.zfill(5)] = {
                "nom": ligne[2].strip(),
                "nbMenages": nombre(ligne[3]),
                "nbPersonnes": nombre(ligne[4]),
                "deciles": deciles,
            }
    return communes


def lire_codes_postaux(chemin):
    """Lit la base La Poste : { CODGEO : ensemble de codes postaux }."""
    correspondance = defaultdict(set)
    with open(chemin, newline="", encoding="utf-8-sig") as f:
        for ligne in csv.reader(f, delimiter=";"):
            if len(ligne) < 3:
                continue
            codgeo, cp = ligne[0].strip(), ligne[2].strip()
            if re.fullmatch(r"\d{4,5}", codgeo) and re.fullmatch(r"\d{5}", cp):
                correspondance[codgeo.zfill(5)].add(cp)
    return correspondance


def parts_categories(deciles):
    """Parts [rouge, orange, jaune, verte] d'une commune, ou None sans données."""
    if any(deciles.get(n) is None for n in ORDRE_BORNES):
        return None
    parts = [0.0, 0.0, 0.0, 0.0]
    for idx, (borne_sup_nom, part_pop) in enumerate(INTERVALLES):
        borne_inf = 0.0 if idx == 0 else deciles[ORDRE_BORNES[idx - 1]]
        borne_sup = float("inf") if borne_sup_nom is None else deciles[borne_sup_nom]
        if borne_sup <= borne_inf:
            continue
        if borne_sup == float("inf"):
            # Intervalle au-dessus de D9 : découpé aux bornes nationales finies
            for cat in range(4):
                nat_inf = 0.0 if cat == 0 else BORNES_NATIONALES[cat - 1]
                nat_sup = float("inf") if cat == 3 else BORNES_NATIONALES[cat]
                if borne_inf < nat_sup:
                    parts[cat] += part_pop
            continue
        largeur = borne_sup - borne_inf
        for cat in range(4):
            nat_inf = 0.0 if cat == 0 else BORNES_NATIONALES[cat - 1]
            nat_sup = float("inf") if cat == 3 else BORNES_NATIONALES[cat]
            chevauchement = max(0.0, min(borne_sup, nat_sup) - max(borne_inf, nat_inf))
            if chevauchement > 0:
                parts[cat] += part_pop * chevauchement / largeur
    total = sum(parts)
    return [round(p / total, 3) for p in parts] if total > 0 else None


def construire_base(communes, correspondance):
    """Agrège par code postal et produit la base compacte finale."""
    agregats = defaultdict(lambda: {"noms": [], "m": 0, "p": 0,
                                     "parts_ponderees": [0.0] * 4, "menages_parts": 0})
    for codgeo, c in communes.items():
        for cp in correspondance.get(codgeo, ()):
            agg = agregats[cp]
            agg["noms"].append(c["nom"])
            menages = int(c["nbMenages"] or 0)
            agg["m"] += menages
            agg["p"] += int(c["nbPersonnes"] or 0)
            parts = parts_categories(c["deciles"])
            if parts is not None and menages > 0:
                for i in range(4):
                    agg["parts_ponderees"][i] += parts[i] * menages
                agg["menages_parts"] += menages
    base = {}
    for cp, agg in sorted(agregats.items()):
        noms = sorted(set(agg["noms"]))
        if len(noms) > 1:
            # CP multi-communes : initiale de la commune principale + « + »
            nom_affiche = noms[0][0].upper() + "+"
        else:
            nom_affiche = noms[0]
        dispo = agg["menages_parts"] > 0
        parts = None
        if dispo:
            parts = [round(p / agg["menages_parts"], 3) for p in agg["parts_ponderees"]]
        base[cp] = {"n": nom_affiche, "m": agg["m"], "p": agg["p"], "r": parts}
    return base


def main():
    for chemin in (FICHIER_FILOSOFI, FICHIER_LAPOSTE):
        if not os.path.exists(chemin):
            sys.exit(f"Source introuvable : {chemin}")
    communes = lire_filosofi(FICHIER_FILOSOFI)
    correspondance = lire_codes_postaux(FICHIER_LAPOSTE)
    print(f"Communes Filosofi lues : {len(communes)}")
    base = construire_base(communes, correspondance)
    with open(FICHIER_SORTIE, "w", encoding="utf-8") as f:
        json.dump(base, f, ensure_ascii=False, separators=(",", ":"))
    with open(FICHIER_SORTIE, "rb") as f:
        taille_gz = len(gzip.compress(f.read())) // 1024
    print(f"Codes postaux écrits : {len(base)}")
    print(f"Taille brute : {os.path.getsize(FICHIER_SORTIE) // 1024} Ko "
          f"— gzippée : {taille_gz} Ko")
    print("Contrôle 78700 :", json.dumps(base.get("78700"), ensure_ascii=False))


if __name__ == "__main__":
    main()
