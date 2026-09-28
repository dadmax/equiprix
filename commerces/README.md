# Simulateur « Que peut m'apporter equiprix ? » (commerces)

Page déployée sur `equiprix.fr/commerces/`. 100 % statique : HTML/CSS/JS
vanilla, calcul local dans le navigateur, aucun envoi de données.

## Structure

```
commerces/
├── index.html                  Page complète (header/footer du site, 3 zones)
├── css/commerces.css           Styles spécifiques (palette du site : style.css)
├── js/app.js                   Logique : état, calculs, rendu, URL
├── data/
│   ├── codes-postaux-precalc.json   Base précalculée indexée par code postal (~6 000)
│   ├── commerces.json               Types de commerce + matrice sondage + paramètres
│   └── source/                      Sources brutes (recette du précalcul)
│       ├── filosofi-2021-communes.csv  Filosofi 2021 par commune (tableur de référence)
│       └── laposte_hexasmal.csv        Base officielle des codes postaux (La Poste)
└── scripts/
    └── precalc-communes.py     Régénère codes-postaux-precalc.json
```

## Format de `codes-postaux-precalc.json`

Indexé par code postal, format compact :

```json
"78700": { "n": "Conflans-Sainte-Honorine", "m": 14515, "p": 36032,
           "r": [0.079, 0.107, 0.172, 0.642] }
```

- `n` : nom d'affichage. Si le CP couvre plusieurs communes : initiale de la
  commune principale suivie de `+` (ex. `"C+"`), l'agrégat reste unique.
- `m` / `p` : ménages fiscaux / personnes (sommes des communes du CP).
- `r` : parts des ménages dans les catégories equiprix nationales
  `[rouge, orange, jaune, verte]` — précalculées à partir des déciles locaux
  (distribution uniforme par intervalle inter-décile, découpée aux bornes
  nationales 2021 : 7 940 / 15 190 / 22 900 €). `null` si aucune donnée
  (secret statistique) : l'interface affiche alors « Données indisponibles ».
- Les revenus disponibles médians 2023 par catégorie (Filosofi 2023) sont des
  constantes nationales : elles vivent dans `js/app.js` (constante
  `REVENU_CATEGORIES`, documentée avec sa source), pas dans la base.

## Régénérer la base (millésimes futurs)

Remplacer `data/source/filosofi-2021-communes.csv` par le nouveau millésime
(mêmes colonnes, export CSV de l'onglet du tableur de référence), puis :

```bash
python3 scripts/precalc-communes.py
```

Le script contrôle le cas de référence (78700 Conflans-Sainte-Honorine) et
affiche les tailles brute/gzippée (~370 Ko / ~100 Ko).

## Éditer `commerces.json` (types de commerce, sondage, paramètres)

Fichier maintenu à la main par l'équipe equiprix — le simulateur ne consomme
jamais les résultats bruts du sondage, uniquement ce fichier.

- **Ajouter/retirer un type de commerce** : une entrée dans `typesCommerce`.
  - `source: "sondage"` → ajouter la ligne correspondante dans `matriceUplift`.
  - `source: "estimation"` → pas de ligne : l'uplift vaut `coefPrudence ×`
    moyenne des lignes listées dans `base`.
- **Mettre à jour le sondage** : ajuster les valeurs de `matriceUplift`
  (paliers mesurés ; l'interpolation entre paliers est linéaire).
- **Paramètres** : `tauxCapture` (5 %), `tauxEquipement` (7,5 %),
  `tauxActivation` (4,05 visites/mois), `margeNette` (3 %) — modifiables en
  mode expert dans l'interface.

Aucun changement de code n'est nécessaire pour ces éditions.

## Formules (référence : tableur de calcul equiprix, fait foi)

Pour chaque catégorie `c` (rouge, orange, jaune) avec réduction `r_c` :

- **Uplift** : interpolation linéaire de la matrice `[r_c × type de commerce]`
  (ou `coefPrudence ×` moyenne des bases pour les types extrapolés).
- **Perte de marge, clients existants** = clients de la catégorie ×
  `tauxEquipement` × `r_c` × panier de la catégorie × marge commerciale.
- **Gain, visites accrues des clients équipés** = clients de la catégorie ×
  `tauxEquipement` × uplift × panier × marge commerciale.
- **Gain, nouveaux clients captés** = (ménages de la commune × couverture ×
  part de la clientèle) × `tauxCapture` × uplift × panier × marge
  commerciale. Le « client potentiel » du tableur = ménage de la catégorie
  couvert par la zone de chalandise ; le « taux d'activation » (~4,05
  visites/mois, affiché en mode expert) est une valeur de contrôle dérivée
  (visites mensuelles ÷ clients potentiels), pas une entrée du calcul.
- **Panier de la catégorie** = panier moyen déclaré × revenu médian de la
  catégorie ÷ revenu moyen de la clientèle (pondéré).
- **Impact net** = Σ (gains − pertes) ; **résultat mensuel** = CA mensuel ×
  `margeNette`.

Cas de contrôle : Conflans-Sainte-Honorine (78700), supermarché, marge 20 %,
47 000 clients, panier 50 €, couverture 80 %, réductions 10/10/10 →
clients potentiels 917/1242/1997 (tableur : 916/1246/1993), taux
d'activation 4,05 visites/potentiel, impact ≈ **+2 279 €/mois**, soit
≈ +3,2 % du résultat mensuel (70 500 €).

## Déploiement OVH

Le site est déployé par simple copie des fichiers (hébergement statique
mutualisé) : pousser le dossier `commerces/` tel quel dans le répertoire
`www/` du site (même arborescence que le dépôt). Le lien « Commerces » du
header du site pointe vers `/commerces/`.
