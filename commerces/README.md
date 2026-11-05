# Page « equiprix pour les commerces » — equiprix.fr/commerces

Page destinée aux commerçants, **contenant un simulateur** : à partir du code
postal, du type de commerce, du profil de clientèle, de l'attractivité et des
réductions envisagées par catégorie equiprix, le simulateur estime l'impact
mensuel sur la marge (clients supplémentaires, perte sur clients existants,
frais de service, solde net rapporté au chiffre d'affaires).

Ordre de la page : en-tête (proposition de valeur + CTA, sous-titre qui
concatène l'accroche « chaque client paie selon ses moyens » + définition de la
tarification solidaire) → bloc `#simulateur` (scénarios +
narratif, « Votre commerce », « Simulation », puis **sources en `<details>`
replié, sans titre H2**) → « Comment ça marche ? » (3 maquettes d'appli,
3 colonnes sur desktop / empilées sur mobile : 1. « Configurez vos réductions »,
2. « Vérifiez les réductions en caisse » (QR + catégorie/revenu certifié),
3. « Vous validez, equiprix s'occupe du reste ») → « Engagement » (stat 90 % +
badge « Commerce engagé equiprix » + **bloc marketing « equiprix gère le
marketing pour vous »**) → « Tarification » (sous-titre « Aligné avec vos intérêts, aligné avec
l'intérêt général », gros KPI 0,50 €/passage à gauche sur desktop / en premier
sur mobile, commission conditionnelle, plafond 100 €/mois précisé « pensé pour
les petits commerces » ; valeurs lues dans `parametres`).
Textes marketing **en dur dans `index.html`** ; maquettes provisoires dans
`commerces/images/` (à remplacer par les vraies).

Rythme des fonds pleine largeur (inversé) : hero bleu clair (`--bg-why`),
**simulateur blanc**, « Comment ça marche ? » **bleu clair pleine largeur**,
« Engagement » **blanc** (son bloc marketing reprend le bleu clair),
« Tarification » **bleu clair pleine largeur**. Chaque section de `main`
embarque son propre `.sim-container`.

CTA « Nous contacter » (lien du bouton « Contactez-moi » de la section
`#commercants` de la page d'accueil) : en bleu dans le hero, et en bleu dans
les résultats du simulateur (au-dessus, « Sauver cette simulation » est en
blanc). Le toggle « Sources et données utilisées » a une flèche ▾ pivotante
(comme les accordéons de `/particuliers/`). Le narratif par défaut
(`textes.narratifDefaut`) ne contient plus que la phrase « Utilisez le
simulateur ci-dessous… » (le reste est dans le sous-titre du hero, en HTML).

## Structure

```
commerces/
├── index.html                     # Page commerçants (hero, simulateur, ccm, engagement, tarification)
├── css/
│   └── commerces.css              # Styles de la page (s'ajoute à ../style.css)
├── images/                        # Maquettes provisoires (etape-1..3.svg, badge-engage.svg)
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
   `codes-postaux-full.json`, ~65 Mo — non versionnée, voir
   `data/source/.gitignore`) dans `data/source/codes-postaux.json`.
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
  service par passage, cap mensuel des frais).

Les bornes de catégories (`bornesCategories`) et les revenus médians
(`revenusCategories`) y figurent également, à titre de référence (le découpage
en catégories est porté par la base codes postaux ; les revenus médians
alimentent le calcul des paniers par catégorie). Les deux barres verticales
côte à côte (secteur / France) utilisent `partsFranceComparatif` (20/20/20/40)
pour le comparatif ; leurs titres et les légendes qualitatives des catégories
sont dans `textes` (`titreBarreSecteur`, `titreBarreFrance`,
`legendesCategories`, `suggestionMargeFaible` — message affiché quand la
marge commerciale est < 15 %, `suggestionResultatNegatif` — deux pistes
affichées quand le solde net est négatif).

**Textes marketing de la page (hero, comment ça marche,
engagement, tarification) : en dur dans `index.html`** — éditables directement,
avec balisage HTML possible. Seules les **valeurs chiffrées** de la
tarification sont injectées depuis le JSON maître : `parametres.fraisServiceParPassage`
et `parametres.capFraisServiceMensuel` remplissent les `<span>`
`#tar-frais-par-passage` et `#tar-cap-mensuel` (les valeurs présentes dans le
HTML servent de repli si le JSON ne charge pas).

## Scénarios (use cases)

Le carrousel en haut de page propose « Simuler sur mon commerce » (par défaut)
plus un onglet par entrée du tableau `useCases` de `commerces.json`.
Chaque use case préconfigure le simulateur **et** le paragraphe narratif :

```json
"useCases": [
  {
    "id": "boulangerie-albertville",
    "nom": "Boulangerie à Albertville",
    "image": "../images/boulangerie.jpg",
    "narratif": "À Albertville, la boulangerie de Mme Martin... (histoire seule, sans répéter les chiffres de la simulation)",
    "params": {
      "cp": "73200",
      "type": "commerceBouche",
      "marge": 0.10,
      "passages": 40,
      "panier": 30,
      "profil": "commune",
      "attr": 20,
      "rr": 0.15, "ro": 0.15, "rj": 0.15
    }
  }
]
```

Champs de `params` (tous optionnels) : `cp` (code postal), `type` (clé de
`typesCommerce`), `marge` (0-1), `passages`, `panier` (€), `profil` (id de
`profilsClientele`), `attr` (facteur d'attractivité 2-20), `rr`/`ro`/`rj`
(réductions rouge/orange/jaune, 0-1). Quand `type` est renseigné sans
`marge`/`passages`/`panier`, les valeurs par défaut du type sont utilisées.
`image` est un chemin relatif (ex. `../images/…`) affiché à côté du narratif ;
sans `image`, aucune illustration n'est affichée. L'`id` du use case est
ajouté à l'URL (`?uc=…`) pour permettre le partage direct d'un scénario.

**Règle d'or des narratifs** : raconter l'histoire du commerce (contexte, enjeux,
ce que equiprix change) **sans citer les résultats chiffrés** affichés par le
simulateur — ils sont déjà à l'écran, les répéter ne sert à rien.

**Mode expert forcé** : si un use case définit des réductions
**différenciées** (ex. 10 % sur rouge/orange, 0 % sur jaune), la
super-catégorie « éligibles » n'a plus de sens : le mode expert est coché
automatiquement (`expert=1` dans l'URL). Les usecases à réductions
identiques restent en mode non expert.

**Modification d'un use case actif** : on garde le use case (et son narratif)
lorsqu'on change un paramètre à la main — c'est voulu, pour explorer. En
revanche un badge « paramètres modifiés » + un bouton « Réinitialiser le
scénario » (à côté du toggle mode expert, en haut de la section Simulation)
apparaissent dès que l'état courant diffère des `params` du use case ; le
bouton restaure les paramètres par défaut du use case. Sur « Simuler sur mon
commerce », aucun badge ni reset.

## Tests

```bash
# Tests unitaires du moteur de calcul (28 tests, cas de référence du tableur)
node tests/test-calculs.js

# Tests d'intégration de l'interface (jsdom, serveur local requis)
python3 -m http.server 8765        # depuis la racine du dépôt
cd /tmp && npm install jsdom whatwg-fetch
NODE_PATH=/tmp/node_modules node tests/test-ui.js
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
- **Mode expert** (toggle en haut de la section « Simulation ») : les trois
  catégories jaune/orange/rouge apparaissent individuellement, avec le détail
  par catégorie des résultats affiché directement. En non expert, une
  super-catégorie « Foyers éligibles equiprix — 60 % de niveaux de vie les
  plus bas » pilote les trois réductions à la même valeur (toggle vers expert :
  la réduction éligibles s'applique aux 3 catégories ; retour en non expert :
  seul le taux le plus bas est conservé). Les revenus médians par catégorie
  apparaissent à côté du panier moyen de chaque catégorie. Pastilles ⓘ avec
  formules sur chaque total.

## Sources

- Répartition des populations communales par niveau de vie : Insee, Filosofi
  2021 (publication 2024) — https://www.insee.fr/fr/metadonnees/source/operation/s2146/presentation
- Revenu disponible des diverses catégories : Insee, Filosofi 2023
  (publication 2026) — https://www.insee.fr/fr/metadonnees/source/operation/s2286/presentation
- Sondage equiprix (taux de venues) : septembre 2026, 60 ménages français (texte dans `textes.sondage`).
- Mapping CODGEO ↔ code postal : base data.gouv.fr « Codes postaux ».

Résultats estimatifs à visée pédagogique, basés sur les hypothèses affichées
en mode expert.
