/* ============================================================
   app.js — Interface du simulateur commerçants.
   Charge les JSON, gère l'état (URL uniquement), recalcule en
   temps réel et met à jour le DOM de façon ciblée.
   ============================================================ */
"use strict";

(function () {
    // ---------- Données chargées au démarrage ----------
    let maître = null;       // data/commerces.json
    let cpBase = null;       // data/codes-postaux-precalc.json
    let indexNoms = [];      // [{cp, nom, nbMenages}] pour l'autocomplétion

    // ---------- État courant ----------
    // Les valeurs par défaut (type, profil, attractivité, réductions) sont
    // initialisées depuis le JSON maître : rien de métier n'est codé en dur.
    const LISTE_REDUCTIONS = [0, 0.05, 0.08, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50];
    const etat = {
        cp: null,               // code postal sélectionné
        type: null,             // id du type de commerce (défini depuis le JSON)
        marge: null,
        passages: null,
        panier: null,
        profil: null,           // id du profil de clientèle (défini depuis le JSON)
        attractiviteIndex: null,
        reductions: {},         // {rouge, orange, jaune} définis depuis le JSON
        expert: false,
        // Paramètres avancés (modifiables en mode expert)
        tauxCapture: null,      // null = valeur du JSON maître
        fraisParPassage: null,
        capFrais: null,
        margeNette: null,
    };

    // ---------- Éléments DOM ----------
    const $ = (id) => document.getElementById(id);
    const els = {
        cpInput: $("cp-input"),
        cpListe: $("cp-liste"),
        cpSelectionne: $("cp-selectionne"),
        cpNom: $("cp-nom"),
        cpDetail: $("cp-detail"),
        cpInfos: $("cp-infos"),
        cpIndisponible: $("cp-indisponible"),
        cpMenages: $("cp-menages"),
        barrePopulation: $("barre-population"),
        cartesType: $("cartes-type"),
        marge: $("marge"),
        passages: $("passages"),
        panier: $("panier"),
        estimationNote: $("estimation-note"),
        profils: $("profils"),
        attractivite: $("attractivite"),
        attractiviteReperes: $("attractivite-reperes"),
        attractiviteNom: $("attractivite-nom"),
        attractiviteFacteur: $("attractivite-facteur"),
        toggleExpert: $("toggle-expert"),
        impactNet: $("impact-net"),
        impactRatio: $("impact-ratio"),
        margeRef: $("marge-ref"),
        heroResultat: $("hero-resultat"),
        recapMarges: $("recap-marges"),
        recapPertes: $("recap-pertes"),
        recapFrais: $("recap-frais"),
        fraisMention: $("frais-mention"),
        detailBody: $("detail-categories-body"),
        suggestion: $("suggestion"),
        btnSauver: $("btn-sauver"),
        sauvegardeOk: $("sauvegarde-ok"),
        tooltip: $("tooltip"),
        expCapture: $("exp-capture"),
        expFrais: $("exp-frais"),
        expCap: $("exp-cap"),
        expMargeNette: $("exp-marge-nette"),
        revenusCategories: $("revenus-categories"),
    };

    // ---------- Initialisation ----------
    async function init() {
        try {
            const [rMaitre, rCp] = await Promise.all([
                fetch("data/commerces.json"),
                fetch("data/codes-postaux-precalc.json"),
            ]);
            if (!rMaitre.ok || !rCp.ok) throw new Error("HTTP " + rMaitre.status + "/" + rCp.status);
            maître = await rMaitre.json();
            cpBase = await rCp.json();
        } catch (e) {
            document.querySelector(".sim-dashboard").insertAdjacentHTML(
                "beforebegin",
                '<p class="sim-warning">Les données n’ont pas pu être chargées. Vérifiez votre connexion puis rechargez la page.</p>'
            );
            return;
        }

        initialiserEtatDepuisJSON();
        construireIndexNoms();
        construireCartesType();
        construireProfils();
        construireJaugeAttractivite();
        construireCouloirs();
        construireParametresExpert();
        restaurerDepuisURL();
        brancherEvenements();
        mettreAJour();
    }

    // Valeurs par défaut issues du JSON maître (aucune valeur métier en dur)
    function initialiserEtatDepuisJSON() {
        const premierType = Object.keys(maître.typesCommerce)[0];
        etat.type = premierType;
        etat.marge = maître.typesCommerce[premierType].margeDefaut;
        etat.passages = maître.typesCommerce[premierType].passagesDefaut;
        etat.pantry = maître.typesCommerce[premierType].panierDefaut;
        // Profil par défaut : « un peu plus aisée que la moyenne » s'il existe
        const profilDefaut = maître.profilsClientele.find((p) => p.id === "unPeuAisee")
            || maître.profilsClientele[Math.min(1, maître.profilsClientele.length - 1)];
        etat.profil = profilDefaut.id;
        // Attractivité par défaut : niveau « moyenne » s'il existe
        const idxMoyenne = maître.attractivite.findIndex((a) => a.id === "moyenne");
        etat.attractiviteIndex = idxMoyenne >= 0 ? idxMoyenne : Math.floor(maître.attractivite.length / 2);
        // Réductions par défaut : 10 % sur les trois catégories réduites
        for (const cat of CATEGORIES_REDUITES) {
            etat.reductions[cat] = 0.10;
        }
        // Remplir les champs
        els.marge.value = Math.round(etat.marge * 100);
        els.passages.value = etat.passages;
        els.panier.value = etat.pantry;
    }

    // Index nom → CP pour l'autocomplétion (trié par ménages décroissants)
    function construireIndexNoms() {
        indexNoms = Object.entries(cpBase).map(([cp, e]) => ({
            cp,
            nom: e.communes[0] || cp,
            nb: e.nbMenages || 0,
            nbCommunes: e.communes.length,
            communes: e.communes,
        }));
        indexNoms.sort((a, b) => b.nb - a.nb);
    }

    // ---------- Construction des contrôles ----------
    function construireCartesType() {
        els.cartesType.innerHTML = "";
        for (const [id, type] of Object.entries(maître.typesCommerce)) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "sim-carte-type";
            btn.setAttribute("role", "radio");
            btn.setAttribute("aria-checked", String(id === etat.type));
            btn.dataset.type = id;
            btn.textContent = type.nom;
            btn.addEventListener("click", () => {
                etat.type = id;
                // Préremplissage des valeurs par défaut du type
                etat.marge = type.margeDefaut;
                etat.passages = type.passagesDefaut;
                etat.panier = type.panierDefaut;
                els.marge.value = Math.round(type.margeDefaut * 100);
                els.passages.value = type.passagesDefaut;
                els.pantry = type.panierDefaut;
                els.panier.value = type.panierDefaut;
                els.estimationNote.hidden = false;
                mettreAJour();
            });
            els.cartesType.appendChild(btn);
        }
    }

    function construireProfils() {
        els.profils.innerHTML = "";
        maître.profilsClientele.forEach((profil) => {
            const label = document.createElement("label");
            label.className = "sim-radio-profil";
            const radio = document.createElement("input");
            radio.type = "radio";
            radio.name = "profil";
            radio.value = profil.id;
            radio.checked = profil.id === etat.profil;
            radio.addEventListener("change", () => {
                etat.profil = profil.id;
                mettreAJour();
            });
            label.appendChild(radio);
            label.appendChild(document.createTextNode(profil.nom));
            els.profils.appendChild(label);
        });
    }

    function construireJaugeAttractivite() {
        // Repères sous le curseur
        els.attractiviteReperes.innerHTML = "";
        maître.attractivite.forEach((a) => {
            const span = document.createElement("span");
            // Libellés raccourcis pour la lisibilité
            span.textContent = a.nom.split(" — ")[0];
            els.attractiviteReperes.appendChild(span);
        });
        els.attractivite.addEventListener("input", () => {
            etat.attractiviteIndex = Number(els.attractivite.value);
            mettreAJour();
        });
    }

    function construireCouloirs() {
        for (const cat of ["rouge", "orange", "jaune"]) {
            const select = $("red-" + cat);
            select.innerHTML = "";
            for (const r of LISTE_REDUCTIONS) {
                const opt = document.createElement("option");
                opt.value = String(r);
                opt.textContent = formaterPourcent(r, 0);
                if (Math.abs(r - etat.reductions[cat]) < 1e-9) opt.selected = true;
                select.appendChild(opt);
            }
            select.addEventListener("change", () => {
                etat.reductions[cat] = Number(select.value);
                mettreAJour();
            });
        }
    }

    function construireParametresExpert() {
        els.expCapture.value = maître.parametres.tauxCapture * 100;
        els.expFrais.value = maître.parametres.fraisServiceParPassage;
        els.expCap.value = maître.parametres.capFraisServiceMensuel;
        els.expMargeNette.value = maître.parametres.margeNetteDefaut * 100;

        // Revenus médians par catégorie (consultables en mode expert)
        els.revenusCategories.innerHTML = "";
        const noms = { rouge: "Rouge", orange: "Orange", jaune: "Jaune", verte: "Verte" };
        for (const cat of CATEGORIES) {
            const div = document.createElement("div");
            const dt = document.createElement("dt");
            dt.textContent = noms[cat];
            const dd = document.createElement("dd");
            dd.textContent = formaterEuros(maître.revenusCategories[cat]);
            div.appendChild(dt);
            div.appendChild(dd);
            els.revenusCategories.appendChild(div);
        }
    }

    // ---------- Événements ----------
    function brancherEvenements() {
        // Menu mobile (cohérent avec le site)
        document.querySelector(".hamburger").addEventListener("click", function () {
            document.querySelector(".nav-sidebar").classList.toggle("open");
        });
        document.querySelectorAll(".nav-sidebar a").forEach((link) => {
            link.addEventListener("click", () => {
                document.querySelector(".nav-sidebar").classList.remove("open");
            });
        });

        // Champs commerce
        els.marge.addEventListener("input", () => {
            etat.marge = (parseFloat(els.marge.value) || 0) / 100;
            els.estimationNote.hidden = true;
            mettreAJour();
        });
        els.passages.addEventListener("input", () => {
            etat.passages = parseInt(els.passages.value, 10) || 0;
            els.estimationNote.hidden = true;
            mettreAJour();
        });
        els.panier.addEventListener("input", () => {
            etat.pantry = parseFloat(els.panier.value) || 0;
            els.estimationNote.hidden = true;
            mettreAJour();
        });

        // Autocomplétion CP
        els.cpInput.addEventListener("input", onRechercheCP);
        els.cpInput.addEventListener("keydown", onClavierCP);
        els.cpInput.addEventListener("blur", () => {
            setTimeout(() => { els.cpListe.hidden = true; }, 200);
        });
        els.cpInput.addEventListener("focus", () => {
            if (els.cpInput.value.trim().length >= 2) onRechercheCP();
        });

        // Mode expert
        els.toggleExpert.addEventListener("change", () => {
            etat.expert = els.toggleExpert.checked;
            document.body.classList.toggle("mode-expert", etat.expert);
            mettreAJourURL();
        });

        // Paramètres avancés
        els.expCapture.addEventListener("input", () => {
            etat.tauxCapture = (parseFloat(els.expCapture.value) ?? maître.parametres.tauxCapture * 100) / 100;
            mettreAJour();
        });
        els.expFrais.addEventListener("input", () => {
            etat.fraisParPassage = parseFloat(els.expFrais.value) ?? maître.parametres.fraisServiceParPassage;
            mettreAJour();
        });
        els.expCap.addEventListener("input", () => {
            etat.capFrais = parseFloat(els.expCap.value) ?? maître.parametres.capFraisServiceMensuel;
            mettreAJour();
        });
        els.expMargeNette.addEventListener("input", () => {
            etat.margeNette = (parseFloat(els.expMargeNette.value) ?? maître.parametres.margeNetteDefaut * 100) / 100;
            mettreAJour();
        });

        // Bouton sauver
        els.btnSauver.addEventListener("click", () => {
            const url = window.location.href;
            const done = () => {
                els.sauvegardeOk.hidden = false;
                setTimeout(() => { els.sauvegardeOk.hidden = true; }, 4000);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopie(url, done));
            } else {
                fallbackCopie(url, done);
            }
        });

        // Pastilles ⓘ
        document.querySelectorAll(".sim-info-btn").forEach((btn) => {
            btn.addEventListener("mouseenter", () => montrerTooltip(btn));
            btn.addEventListener("focus", () => montrerTooltip(btn));
            btn.addEventListener("click", () => montrerTooltip(btn));
            btn.addEventListener("mouseleave", cacherTooltip);
            btn.addEventListener("blur", cacherTooltip);
        });

        // Fermer la liste d'autocomplétion en cliquant ailleurs
        document.addEventListener("click", (e) => {
            if (!els.cpInput.contains(e.target) && !els.cpListe.contains(e.target)) {
                els.cpListe.hidden = true;
            }
        });
    }

    function fallbackCopie(texte, done) {
        const ta = document.createElement("textarea");
        ta.value = texte;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); done(); } catch (e) { /* silencieux */ }
        document.body.removeChild(ta);
    }

    // ---------- Autocomplétion code postal ----------
    let resultatsCP = [];
    let indexCPClavier = -1;

    function normaliserTexte(t) {
        return t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    }

    function onRechercheCP() {
        const q = normaliserTexte(els.cpInput.value.trim());
        els.cpListe.innerHTML = "";
        if (q.length < 2) {
            els.cpListe.hidden = true;
            return;
        }
        // Recherche : CP commençant par q, ou nom contenant q
        resultatsCP = indexNoms.filter((e) => {
            if (/^\d+$/.test(q)) return e.cp.startsWith(q);
            return normaliserTexte(e.nom).includes(q);
        }).slice(0, 20);

        if (resultatsCP.length === 0) {
            els.cpListe.hidden = true;
            return;
        }
        resultatsCP.forEach((e, i) => {
            const li = document.createElement("li");
            li.setAttribute("role", "option");
            li.dataset.index = String(i);
            const code = document.createElement("span");
            code.className = "cp-code";
            code.textContent = e.cp;
            li.appendChild(code);
            li.appendChild(document.createTextNode(e.nom + (e.nbCommunes > 1 ? ` et ${e.nbCommunes - 1} autre${e.nbCommunes > 2 ? "s" : ""} commune${e.nbCommunes > 2 ? "s" : ""}` : "")));
            li.addEventListener("mousedown", (ev) => {
                ev.preventDefault();
                choisirCP(e.cp);
            });
            els.cpListe.appendChild(li);
        });
        els.cpListe.hidden = false;
        els.cpInput.setAttribute("aria-expanded", "true");
        indexCPClavier = -1;
    }

    function onClavierCP(e) {
        if (els.cpListe.hidden) return;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            indexCPClavier = Math.min(indexCPClavier + 1, resultatsCP.length - 1);
            surlignerOptionCP();
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            indexCPClavier = Math.max(indexCPClavier - 1, 0);
            surlignerOptionCP();
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (indexCPClavier >= 0 && resultatsCP[indexCPClavier]) {
                choisirCP(resultatsCP[indexCPClavier].cp);
            }
        } else if (e.key === "Escape") {
            els.cpListe.hidden = true;
        }
    }

    function surlignerOptionCP() {
        els.cpListe.querySelectorAll("li").forEach((li, i) => {
            li.setAttribute("aria-selected", String(i === indexCPClavier));
        });
    }

    function choisirCP(cp) {
        etat.cp = cp;
        els.cpListe.hidden = true;
        els.cpInput.setAttribute("aria-expanded", "false");
        const e = cpBase[cp];
        els.cpInput.value = "";
        els.cpSelectionne.hidden = false;
        els.cpNom.textContent = `${cp} — ${e.communes[0]}`;
        if (e.communes.length > 1) {
            els.cpDetail.textContent = `et ${e.communes.length - 1} autre${e.communes.length > 2 ? "s" : ""} commune${e.communes.length > 2 ? "s" : ""}`;
            els.cpDetail.title = e.communes.join(", ");
        } else {
            els.cpDetail.textContent = "";
            els.cpDetail.removeAttribute("title");
        }
        els.cpIndisponible.hidden = e.donneesDispo;
        els.cpInfos.hidden = !e.donneesDispo;
        mettreAJour();
    }

    // ---------- Calcul et affichage ----------
    function parametresEffectifs() {
        return {
            tauxCapture: etat.tauxCapture ?? maître.parametres.tauxCapture,
            fraisServiceParPassage: etat.fraisParPassage ?? maître.parametres.fraisServiceParPassage,
            capFraisServiceMensuel: etat.capFrais ?? maître.parametres.capFraisServiceMensuel,
            margeNetteDefaut: etat.margeNette ?? maître.parametres.margeNetteDefaut,
        };
    }

    // Parts population de secours si CP sans données : moyenne française
    const PARTS_MOYENNE_FRANCE = { rouge: 0.20, orange: 0.20, jaune: 0.20, verte: 0.40 };

    function obtenirPartsPop() {
        if (etat.cp && cpBase[etat.cp] && cpBase[etat.cp].donneesDispo) {
            return cpBase[etat.cp].parts;
        }
        return PARTS_MOYENNE_FRANCE;
    }

    function obtenirType() {
        const type = maître.typesCommerce[etat.type];
        // Ligne de matrice pour les types « sondage » : même clé que l'id du type
        return { ...type, idMatrice: etat.type };
    }

    function obtenirProfil() {
        return maître.profilsClientele.find((p) => p.id === etat.profil) || maître.profilsClientele[0];
    }

    function obtenirFacteurAttractivite() {
        return maître.attractivite[etat.attractiviteIndex].facteur;
    }

    let dernierResultat = null;

    function mettreAJour() {
        if (!maître || !cpBase) return;

        const partsPop = obtenirPartsPop();
        const resultat = simulerMois({
            partsPop,
            revenus: maître.revenusCategories,
            type: obtenirType(),
            profil: obtenirProfil(),
            facteurAttractivite: obtenirFacteurAttractivite(),
            marge: etat.marge,
            passages: etat.passages,
            panier: etat.pantry,
            reductions: etat.reductions,
            parametres: parametresEffectifs(),
            matrice: maître.matriceUplift,
        });
        dernierResultat = { resultat, partsPop };

        mettreAJourCommune();
        mettreAJourCommerce();
        mettreAJourCouloirs(resultat, partsPop);
        mettreAJourResultats(resultat);
        mettreAJourSuggestion(resultat);
        mettreAJourURL();
    }

    // --- Zone gauche : commune ---
    function mettreAJourCommune() {
        if (!etat.cp) return;
        const e = cpBase[etat.cp];
        if (!e.donneesDispo) return;

        for (const cat of CATEGORIES) {
            const seg = els.barrePopulation.querySelector(`.sim-seg-${cat}`);
            const part = e.parts[cat];
            seg.style.width = (part * 100) + "%";
            seg.title = `${formaterPourcent(part, 1)}`;
        }
        $("leg-rouge").textContent = `Rouge — ${formaterPourcent(e.parts.rouge, 1)}`;
        $("leg-orange").textContent = `Orange — ${formaterPourcent(e.parts.orange, 1)}`;
        $("leg-jaune").textContent = `Jaune — ${formaterPourcent(e.parts.jaune, 1)}`;
        $("leg-verte").textContent = `Verte — ${formaterPourcent(e.parts.verte, 1)}`;
        els.cpMenages.textContent = `${formaterNombre(e.nbMenages)} ménages dans le secteur`;
    }

    // --- Zone centre : commerce ---
    function mettreAJourCommerce() {
        // Cartes type
        els.cartesType.querySelectorAll(".sim-carte-type").forEach((btn) => {
            btn.setAttribute("aria-checked", String(btn.dataset.type === etat.type));
        });
        // Jauge attractivité
        const a = maître.attractivite[etat.attractiviteIndex];
        els.attractivite.value = String(etat.attractiviteIndex);
        els.attractiviteNom.textContent = a.nom;
        els.attractiviteFacteur.textContent = `Facteur multiplicatif × ${a.facteur}`;
    }

    // --- Couloirs réductions ---
    function mettreAJourCouloirs(resultat, partsPop) {
        for (const cat of CATEGORIES) {
            const r = resultat.parCategorie[cat];
            $("info-part-" + cat).textContent = formaterPourcent(r.partClientele, 1);
            $("info-passages-" + cat).textContent = formaterNombre(r.passagesReels);
            $("info-panier-" + cat).textContent = formaterEuros(r.panier, 2);
            if (CATEGORIES_REDUITES.includes(cat)) {
                $("info-potentiel-" + cat).textContent = formaterNombre(r.potentiel);
                $("info-clients-" + cat).textContent = "+" + formaterNombre(r.clientsPlus);
                // Uplift en direct
                const el = $("uplift-" + cat);
                const source = r.upliftSource === "estimation" ? "estimation prudente" : "sondage equiprix";
                el.textContent = `≈ +${formaterPourcent(r.uplift, 0)} de visites (${source})`;
                // Masquer les lignes vides (part clientèle ~ 0)
                const couloir = document.querySelector(`.sim-couloir-${cat}`);
                couloir.classList.toggle("sim-couloir-vide", r.partClientele < 0.001);
            }
        }
    }

    // --- Zone droite : résultats ---
    function mettreAJourResultats(resultat) {
        const impact = resultat.impactNet;
        const signe = impact > 0.005 ? "+" : impact < -0.005 ? "−" : "";
        els.impactNet.textContent = `${signe}${formaterEuros(Math.abs(impact))} par mois`;

        els.heroResultat.classList.remove("positif", "negatif", "neutre");
        els.heroResultat.classList.add(
            Math.abs(impact) < 0.005 ? "neutre" : impact > 0 ? "positif" : "negatif"
        );

        if (resultat.impactRelatif !== null) {
            const ratio = resultat.impactRelatif;
            const s = ratio > 0.0005 ? "+" : ratio < -0.0005 ? "−" : "";
            els.impactRatio.textContent = `${s}${formaterPourcent(Math.abs(ratio), 1)} de votre marge commerciale mensuelle`;
            els.impactRatio.hidden = false;
        } else {
            // Garde-fou : marge nulle ou négative -> masquer le ratio
            els.impactRatio.hidden = true;
        }
        els.margeRef.textContent = `Marge commerciale mensuelle : ${formaterEuros(resultat.margeMensuelle)}`;
        els.margeRef.hidden = resultat.margeMensuelle <= 0;

        els.recapMarges.textContent = `+${formaterEuros(resultat.totalMargesSup, 2)}`;
        els.recapPertes.textContent = `−${formaterEuros(resultat.totalPertes, 2)}`;
        els.recapFrais.textContent = `−${formaterEuros(resultat.fraisTotal, 2)}`;
        els.fraisMention.textContent = resultat.fraisCapes ? "(plafonnés)" : "";

        // Tableau par catégorie
        els.detailBody.innerHTML = "";
        const noms = { rouge: "Rouge", orange: "Orange", jaune: "Jaune", verte: "Verte" };
        for (const cat of CATEGORIES) {
            const r = resultat.parCategorie[cat];
            const tr = document.createElement("tr");
            const th = document.createElement("td");
            th.innerHTML = `<span class="cat-nom"><span class="sim-dot sim-dot-${cat}" aria-hidden="true"></span>${noms[cat]}</span>`;
            tr.appendChild(th);
            for (const val of [r.margeSup, r.perte, r.fraisBrut]) {
                const td = document.createElement("td");
                td.textContent = formaterEuros(val, 2);
                tr.appendChild(td);
            }
            els.detailBody.appendChild(tr);
        }
    }

    // --- Suggestion contextuelle ---
    function mettreAJourSuggestion(resultat) {
        let texte = "";
        if (etat.marge > 0 && etat.marge < 0.15) {
            texte = "Avec une marge inférieure à 15 %, les réductions equiprix sont rarement gagnantes : vérifiez votre marge réelle.";
        } else if (resultat.impactNet < 0) {
            // Suggestion chiffrée : réduire la réduction la plus élevée
            const cat = CATEGORIES_REDUITES.reduce((max, c) =>
                etat.reductions[c] > etat.reductions[max] ? c : max, "rouge");
            const rActuelle = etat.reductions[cat];
            if (rActuelle > 0) {
                // Tester la réduction inférieure dans la liste
                const idx = LISTE_REDUCTIONS.indexOf(rActuelle);
                if (idx > 0) {
                    const rTest = LISTE_REDUCTIONS[idx - 1];
                    const sauv = etat.reductions[cat];
                    etat.reductions[cat] = rTest;
                    const test = simulerMois({
                        partsPop: obtenirPartsPop(),
                        revenus: maître.revenusCategories,
                        type: obtenirType(),
                        profil: obtenirProfil(),
                        facteurAttractivite: obtenirFacteurAttractivite(),
                        marge: etat.marge,
                        passages: etat.passages,
                        panier: etat.pantry,
                        reductions: etat.reductions,
                        parametres: parametresEffectifs(),
                        matrice: maître.matriceUplift,
                    });
                    etat.reductions[cat] = sauv;
                    if (test.impactNet > 0) {
                        texte = `En passant la réduction ${cat} de ${formaterPourcent(rActuelle, 0)} à ${formaterPourcent(rTest, 0)}, votre résultat devient positif : +${formaterEuros(test.impactNet)} par mois.`;
                    } else {
                        texte = "Essayez de réduire vos taux de réduction ou d'augmenter votre marge : ajustez les paramètres pour trouver un solde positif.";
                    }
                } else {
                    texte = "Essayez de réduire vos taux de réduction ou d'augmenter votre marge : ajustez les paramètres pour trouver un solde positif.";
                }
            } else {
                texte = "Aucune réduction appliquée : equiprix vous coûte les frais de service sans générer de marge supplémentaire. Envisagez une réduction sur au moins une catégorie.";
            }
        }
        els.suggestion.textContent = texte;
        els.suggestion.hidden = !texte;
    }

    // ---------- Infobulles ⓘ ----------
    function montrerTooltip(btn) {
        if (!dernierResultat) return;
        const { resultat } = dernierResultat;
        const kind = btn.dataset.info;
        let texte = "";
        if (kind === "marges") {
            texte = "Marge supplémentaire = Σ clients en plus × panier moyen × (marge − réduction), par catégorie.";
            if (etat.expert) {
                texte += " Détail : " + CATEGORIES_REDUITES.map((c) => {
                    const r = resultat.parCategorie[c];
                    return `${c} : ${formaterNombre(r.clientsPlus)} clients × ${formaterEuros(r.panier, 2)} × ${formaterPourcent(etat.marge - etat.reductions[c], 0)} = ${formaterEuros(r.margeSup, 2)}`;
                }).join(" ; ");
            }
        } else if (kind === "pertes") {
            texte = "Perte = passages réels × panier moyen × taux de capture × réduction (la réduction se prend sur le chiffre d'affaires).";
            if (etat.expert) {
                texte += " Détail : " + CATEGORIES_REDUITES.map((c) => {
                    const r = resultat.parCategorie[c];
                    return `${c} : ${formaterNombre(r.passagesReels)} × ${formaterEuros(r.panier, 2)} × ${formaterPourcent(parametresEffectifs().tauxCapture, 0)} × ${formaterPourcent(etat.reductions[c], 0)} = ${formaterEuros(r.perte, 2)}`;
                }).join(" ; ");
            }
        } else if (kind === "frais") {
            const p = parametresEffectifs();
            texte = `Frais = ${formaterEuros(p.fraisServiceParPassage, 2)} × (passages réels + clients en plus), toutes catégories, plafonnés à ${formaterEuros(p.capFraisServiceMensuel)} par mois.`;
            texte += ` Total avant cap : ${formaterEuros(resultat.fraisTotalBrut, 2)}.`;
        }
        els.tooltip.textContent = texte;
        els.tooltip.hidden = false;
        const rect = btn.getBoundingClientRect();
        els.tooltip.style.left = Math.min(rect.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - 340) + "px";
        els.tooltip.style.top = (rect.bottom + window.scrollY + 8) + "px";
    }

    function cacherTooltip() {
        els.tooltip.hidden = true;
    }

    // ---------- État dans l'URL ----------
    function mettreAJourURL() {
        const params = new URLSearchParams();
        if (etat.cp) params.set("cp", etat.cp);
        params.set("type", etat.type);
        params.set("marge", String(etat.marge));
        params.set("pass", String(etat.passages));
        params.set("panier", String(etat.pantry));
        params.set("profil", etat.profil);
        params.set("attr", String(obtenirFacteurAttractivite()));
        params.set("rr", String(etat.reductions.rouge));
        params.set("ro", String(etat.reductions.orange));
        params.set("rj", String(etat.reductions.jaune));
        if (etat.expert) params.set("expert", "1");
        const qs = params.toString();
        history.replaceState(null, "", qs ? "?" + qs : window.location.pathname);
    }

    function restaurerDepuisURL() {
        const p = new URLSearchParams(window.location.search);
        const get = (k) => p.get(k);

        // Code postal
        const cp = get("cp");
        if (cp && cpBase[cp]) {
            choisirCP(cp);
        }
        // Type de commerce
        const type = get("type");
        if (type && maître.typesCommerce[type]) {
            etat.type = type;
            // Préremplir avec les valeurs du type, puis écraser par l'URL
            const t = maître.typesCommerce[type];
            etat.marge = t.margeDefaut;
            etat.passages = t.passagesDefaut;
            etat.pantry = t.panierDefaut;
            els.marge.value = Math.round(etat.marge * 100);
            els.passages.value = etat.passages;
            els.panier.value = etat.pantry;
        }
        // Valeurs numériques
        const marge = parseFloat(get("marge"));
        if (!isNaN(marge) && marge >= 0 && marge <= 1) etat.marge = marge;
        const pass = parseInt(get("pass"), 10);
        if (!isNaN(pass) && pass >= 0) etat.passages = pass;
        const panier = parseFloat(get("panier"));
        if (!isNaN(panier) && panier >= 0) etat.pantry = panier;
        // Profil
        const profil = get("profil");
        if (profil && maître.profilsClientele.some((pr) => pr.id === profil)) {
            etat.profil = profil;
            const radio = els.profils.querySelector(`input[value="${profil}"]`);
            if (radio) radio.checked = true;
        }
        // Attractivité (par facteur)
        const attr = parseInt(get("attr"), 10);
        if (!isNaN(attr)) {
            const idx = maître.attractivite.findIndex((a) => a.facteur === attr);
            if (idx >= 0) etat.attractiviteIndex = idx;
        }
        // Réductions
        for (const [cle, cat] of [["rr", "rouge"], ["ro", "orange"], ["rj", "jaune"]]) {
            const v = parseFloat(get(cle));
            if (!isNaN(v) && v >= 0 && v <= 1) {
                etat.reductions[cat] = v;
                const select = $("red-" + cat);
                // Arrondir à la valeur la plus proche de la liste si hors grille
                const proche = LISTE_REDUCTIONS.reduce((prev, curr) =>
                    Math.abs(curr - v) < Math.abs(prev - v) ? curr : prev);
                etat.reductions[cat] = proche;
                if (select) select.value = String(proche);
            }
        }
        // Mode expert
        if (get("expert") === "1") {
            etat.expert = true;
            els.toggleExpert.checked = true;
            document.body.classList.add("mode-expert");
        }
        // Remplir les champs avec l'état restauré
        els.marge.value = Math.round(etat.marge * 100);
        els.passages.value = etat.passages;
        els.panier.value = etat.pantry;
    }

    // ---------- Démarrage ----------
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
