# Simulateur de niveau de vie — equiprix.fr/particuliers

## Structure

```
particuliers/
├── index.html                  # Page du simulateur (4 sections)
├── css/
│   └── simulateur.css           # Styles du simulateur (s'ajoute à ../style.css)
├── js/
│   ├── calculs.js               # Logique métier pure (UC, percentile, catégorie)
│   └── app.js                   # Interface : saisie, jauge, mises à jour temps réel
├── data/
│   ├── niveaux-vie-dep-2023.json    # Données servies au navigateur (101 départements + France)
│   └── source/                     # Fichiers Insee bruts (xlsx/csv) — non servis
└── scripts/
    └── xlsx-to-json.py         # Conversion Insee -> JSON (réutilisable par millésime)
```

La page importe le style global du site (`../style.css`) : toute évolution du
header, du footer ou de la palette s'applique automatiquement.

## Régénération du JSON

1. Télécharger le fichier Insee Filosofi (dispositif Filosofi 2, millésime
   2023 : `FILOSOFI_CC_2023_FR.xlsx`) depuis
   <https://www.insee.fr/fr/statistiques/8984752> et le déposer dans
   `data/source/`.
2. Lancer la conversion :

   ```bash
   python3 scripts/xlsx-to-json.py data/source/FILOSOFI_CC_2023_FR.xlsx
   # ou, pour un export CSV équivalent :
   python3 scripts/xlsx-to-json.py data/source/<fichier>.csv
   ```

   Dépendance (xlsx uniquement) : `pip install openpyxl`.

Le script reconnaît le xlsx multi-onglets Insee (onglets `FRANCE` et `DEP`),
un xlsx mono-onglet ou un CSV. Il nettoie les particularités des fichiers
Insee : lignes d'en-tête, espaces fines insécables (U+00AF / U+202F),
virgules décimales, sauts de ligne parasites dans les cellules. Il attend
97 départements (métropole y compris la Corse 2A/2B, plus La Réunion 974 —
champ de la diffusion Filosofi 2023) et affiche un avertissement sinon.
La ligne France métropolitaine (code `FM`) devient la clé `france` du JSON.

**Données actuelles** : le JSON en dépôt a été généré à partir de
`data/source/FILOSOFI_CC_2023_FR.xlsx` (97 départements + France).

## Déploiement OVH (hébergement statique)

Transférer par FTP (FileZilla ou l'explorateur OVH) **tout le contenu du dossier
`particuliers/`** à la racine du site, en conservant l'arborescence :

```
www/
├── index.html          # page d'accueil existante
├── style.css
├── images/
└── particuliers/
    ├── index.html
    ├── css/simulateur.css
    ├── js/calculs.js
    ├── js/app.js
    └── data/niveaux-vie-dep-2023.json
```

Ne pas transférer `scripts/` ni `data/source/` (inutiles côté serveur).
La page est ensuite accessible sur `equiprix.fr/particuliers` (URL propre, OVH
sert automatiquement `particuliers/index.html`).

## Fonctionnement

- **Aucun backend** : un seul `fetch` au chargement pour
  `data/niveaux-vie-dep-2023.json` ; tous les calculs sont locaux, aucune donnée
  n'est envoyée.
- **Unités de consommation** (échelle OCDE modifiée) : 1 UC pour le premier
  adulte, 0,5 par autre personne de 14 ans ou plus, 0,3 par enfant de moins de
  14 ans. Niveau de vie = revenu annuel net / UC.
- **Percentile** : interpolation linéaire entre les bornes D1, Q1, D3…D7, Q3,
  D8, D9 de la population choisie (France ou département).
- **Catégorie equiprix** (rouge / orange / jaune / verte) : toujours calculée
  sur les bornes France, indépendamment du segment de la jauge.
