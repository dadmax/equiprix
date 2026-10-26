# Simulateur « Que peut m'apporter equiprix ? » — equiprix.fr/commerces

Simulateur destiné aux commerçants : à partir du code postal, du type de
commerce, du profil de clientèle, de l'attractivité et des réductions
envisagées par catégorie equiprix, il estime l'impact mensuel sur la marge
(clients supplémentaires, perte sur clients existants, frais de service,
solde net rapporté au chiffre d'affaires).

## Structure

```
commerces/
├── index.html                     # Page du simulateur (tableau de bord 3 zones)
├── css/
│   └── commerces.css              # Styles du simulateur (s'ajoute à ../style.css)
├── js/
│   ├── calculs.js                 # Logique métier pure (testable sous Node)
│   └── app.js                     # Interface : saisie, URL, mises à jour temps réel
├── data/
│   ├── commerces.json             # JSON maître (types, matrice uplift, profils, paramètres)
│   ├── codes-postaux-precalc.json # Base indexée par code postal (~6 000 entrées)
│   └── source/                    # Fichiers bruts — non servis
│       ├── communes-2021.csv      # Onglet Filosofi 2021 + communes (tableur de référence)
│       ├── codes-postaux.json     # Base data.gouv.fr « Codes postaux » (format full)
│       ├── commerces-v3-simplif.csv  # Onglet prototype (référence de calcul)
│       └── france-2023.csv        # Onglet Filosofi 2023 (revenus médians)
└── scripts/
    └── precalc-codes-postaux.py   # Génération de la base codes postaux
```

La page importe le style global du site (`../style.css`) : header, footer et
palette sont ceux du site. Le lien « Commerces » du header pointe vers
`/commerces/`.

## Régénération de la base codes postaux

1. Télécharger l'onglet « France 2021 + communes 2021 » (gid=261338767) du
   tableur de référence en CSV et le déposer dans `data/source/communes-2021.csv` :

   ```
   https://docs.google.com/spreadsheets/d/e/2PACX-1vSZBMUCcRYH3z_ElxTaJ_A6LOhRr1T246rx8Qxr3TTLKNly2oLotTXYvkwWcrTQU08fy-dT8p0s2Cy3/pub?gid=261338767&single=true&output=csv
   ```

2. Télécharger la base data.gouv.fr « Codes postaux » (ressource
   `codes-postaux-full.json`) dans `data/source/codes-postaux.json`.
3. Lancer la génération :

   ```bash
   python3 scripts/precalc-codes-postaux.py
   ```

   Le script contrôle automatiquement le cas de référence (78700 Conflans-Sainte-Honorine :
   14 515 ménages, parts 15,3 / 13,2 / 15,6 / 55,9 %) et signale tout écart.

Méthode : pour chaque commune, les ménages sont supposés uniformément répartis
dans chaque intervalle inter-décile local (D1-D2, D2-Q1, Q1-D3, D3-D4, D4-Q2,
Q2-D6, D6-D7, D7-D8, D8-D9, au-dessus de D9), puis découpés aux bornes
nationales 2021 (D2 = 13 200 €, D4 = 19 960 €, D6 = 26 080 €). Les communes
sont agrégées par code postal (ménages sommés, parts pondérées). Les communes
sans données Filosofi sont réparties selon la moyenne nationale ; un code postal
dont l'agrégat n'a aucune donnée porte `donneesDispo: false`.

## Édition du JSON maître

Toutes les évolutions métier se font **uniquement** par édition de
`data/commerces.json`, sans toucher au code :

- **Ajouter/retirer un type de commerce** : entrée dans `typesCommerce`
  (`source: "sondage"` avec une ligne dans `matriceUplift`, ou
  `source: "estimation"` avec `coefPrudence` et `base`) ;
- **Ajouter/retirer un profil de clientèle** : entrée dans `profilsClientele` ;
- **Ajouter/retirer un niveau d'attractivité** : entrée dans `attractivite` ;
- **Ajuster les uplifts** : lignes de `matriceUplift` (la liste `reductions`
  définit les paliers ; l'uplift s'interpole linéairement entre deux paliers) ;
- **Ajuster les paramètres** : bloc `parametres` (taux de capture, frais de
  service par passage, cap mensuel, marge nette de référence).

Les bornes de catégories (`bornesCategories`) et les revenus médians
(`revenusCategories`) y figurent également, à titre de référence (le découpage
en catégories est porté par la base codes postaux ; les revenus médians
alimentent le calcul des paniers par catégorie).

## Tests

```bash
# Tests unitaires du moteur de calcul (28 tests, cas de référence du tableur)
node tests/test-calculs.js

# Test d'intégration de l'interface (jsdom, serveur local requis)
python3 -m http.server 8765        # depuis la racine du dépôt
node tests/test-ui.js
```

Le cas de référence validé est celui du tableur « Commerces v3 simplif » :
Conflans-Sainte-Honorine, commerce de bouche, clientèle « un peu plus aisée »,
attractivité moyenne (×8), 1 000 passages, panier 30 €, marge 30 %,
réductions 10 % partout → pertes 55,81 €, marges supplémentaires 489,59 €,
frais capés 100 €, **impact net 333,78 €/mois** (+3,7 % de la marge mensuelle,
+1,11 pt de CA). L'implémentation en virgule flottante produit 334,43 €
(écart de 0,65 €, dû aux arrondis intermédiaires du tableur) : les tests
valident à ±1 € près et vérifient la cohérence interne exacte
(marges sup − pertes − frais = impact net).

## Déploiement OVH (hébergement statique)

Transférer par FTP **tout le contenu du dossier `commerces/`** sous
`www/commerces/`, en conservant l'arborescence :

```
www/
├── index.html            # page d'accueil existante
├── style.css
├── images/
├── particuliers/         # inchangé
└── commerces/
    ├── index.html
    ├── css/commerces.css
    ├── js/calculs.js
    ├── js/app.js
    └── data/commerces.json
    └── data/codes-postaux-precalc.json
```

Ne pas transférer `scripts/` ni `data/source/` (inutiles côté serveur).
La page est accessible sur `equiprix.fr/commerces` (OVH sert automatiquement
`commerces/index.html`).

## Fonctionnement

- **Aucun backend** : deux `fetch` au chargement (`data/commerces.json`,
  `data/codes-postaux-precalc.json`) ; tous les calculs sont locaux.
- **État = URL uniquement** : l'état complet est encodé dans les paramètres
  GET (`?cp=78700&type=commerceBouche&marge=0.3&pass=1000&panier=30&profil=unPeuAisee&attr=8&rr=0.10&ro=0.10&rj=0.10`),
  mis à jour via `history.replaceState` à chaque interaction. Pas de
  localStorage. Le bouton « Sauver » copie l'URL dans le presse-papiers.
- **Recalcul en temps réel** à chaque interaction, mises à jour ciblées du DOM.
- **Mode expert** (toggle discret) : décomposition par catégorie, paramètres
  avancés modifiables (taux de capture, frais, cap), revenus médians
  consultables, pastilles ⓘ avec formules détaillées.

## Sources

- Répartition des populations communales par niveau de vie : Insee, Filosofi
  2021 (publication 2024) — https://www.insee.fr/fr/metadonnees/source/operation/s2146/presentation
- Revenu disponible des diverses catégories : Insee, Filosofi 2023
  (publication 2026) — https://www.insee.fr/fr/metadonnees/source/operation/s2286/presentation
- Mapping CODGEO ↔ code postal : base data.gouv.fr « Codes postaux ».

Résultats estimatifs à visée pédagogique, basés sur les hypothèses affichées
en mode expert.
