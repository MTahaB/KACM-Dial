# NOTES — Dial, journal technique

## Sprint créatif final (2026-07-05, nuit — pour la vidéo)

Quatre features 100% frontend (aucun changement backend, contrat §4 intact),
toutes vérifiées en preview offline (mock), zéro erreur console :

1. **FLIP des scellés** — au changement de niveau, la prose se dissout mais les
   puces scellées GLISSENT physiquement vers leur nouvelle position (overlay
   `fly-layer`, 450ms). La thèse du produit rendue visible. `prefers-reduced-motion`
   respecté.
2. **Photo-develop (§3.3 enfin implémenté)** — le reader se monte dès l'ingest ;
   les paragraphes en attente sont des fantômes sépia de l'original qui se
   « développent » un à un, ✓ vert Nemotron qui pop après audit. Le mock simule
   le développement en ~7s pour la démo offline ; le vrai backend fait pareil
   via le fallback pending existant.
3. **Scrub continu du dial** — glisser au pointeur, tous les niveaux préchargés
   (swaps zéro latence depuis le cache), snap au relâcher, clavier conservé.
4. **Compteur de lecture** — « ⏱ 4 min » + badge « −27% » vs expert, à côté du dial.

**Pour la vidéo (Ismail)** : le develop réel sur CPU est lent (~100s/paragraphe) —
filmer le develop soit sur la machine GPU, soit en mode mock (`npm run dev:mock`,
honnêtement présenté comme accéléré), soit en timelapse. Le scrub + FLIP + compteur
se filment sur le vrai backend une fois le doc généré (lecture cache instantanée).

---

# DiffusionGemma, reconnaissance (Étape −1 du brief)

Recon effectuée le 2026-07-04. Réseau requis pour cette étape uniquement.
**Aucun code du pipeline Ollama (Tier 1-3) n'a été modifié.**

## Modèle résolu

| Champ | Valeur |
|---|---|
| ID HF officiel | `google/diffusiongemma-26B-A4B-it` |
| Architecture | 26B MoE, **3,8B actifs**, encoder-decoder, Uniform State Diffusion |
| Canvas | **256 tokens** par bloc (→ `max_tokens ≤ 512` = 1-2 blocs, conforme au brief) |
| Contexte | 256K tokens |
| Licence | **Apache 2.0 — PAS gated**, aucune acceptation de licence requise ✅ |
| VRAM | « fits within 18 GB VRAM » une fois quantizé (doc Google officielle) |
| Serving | `vllm serve "google/diffusiongemma-26B-A4B-it"` (aucune version min. documentée — « latest ») ; SGLang en alternative |

## Variantes quantizées (préférer un checkpoint officiel — auto-détecté par vLLM)

- `RedHatAI/diffusiongemma-26B-A4B-it-FP8-dynamic` — FP8, bon candidat vLLM
- `nvidia/diffusiongemma-26B-A4B-it-NVFP4` — NVFP4 (GPU récents, Blackwell)
- `cyankiwi/diffusiongemma-26B-A4B-it-AWQ-INT4` — AWQ INT4
- `unsloth/diffusiongemma-26B-A4B-it-GGUF` — **GGUF → potentiellement Ollama direct !**

### ⚡ Piste à tester EN PREMIER sur la machine GPU (avant tout WSL/vLLM)
La fiche HF liste des quantizations « llama.cpp, LM Studio, Jan, **Ollama** ».
Si `ollama pull hf.co/unsloth/diffusiongemma-26B-A4B-it-GGUF:Q4_K_M` fonctionne
(= sampler diffusion supporté par la version d'Ollama installée), **toute
l'étape 0-1 du brief (WSL2 + vLLM + orchestration VRAM) devient inutile** :
même runtime que le reste du pipeline, `WRITER_MODEL` suffit presque.
À tester en 15 min chrono avant d'investir dans vLLM.

## Étape 2 (microscope) — plus dure que prévu
- Dépôt : https://github.com/google/hackable_diffusion — toolbox **JAX** (pas
  PyTorch), sous-librairies `architecture / corruption / inference / loss /
  sampling`. Licence Apache 2.0.
- La confiance par token n'est PAS documentée comme exposée ; la boucle est en
  JAX avec le checkpoint d'entraînement, pas le serving vLLM. Intercepter la
  trace = installer un 2e stack (JAX+GPU). Le kill-switch 4h du brief est très
  susceptible de déclencher. Prévoir le renoncement sans regret.
- Fine-tuning adapter : dans le dépôt Gemma, pas dans hackable_diffusion.

## Gate matériel — CETTE machine (dev, XPS)

| Ressource | Constat | Requis | Verdict |
|---|---|---|---|
| GPU | Intel HD 620 (pas de NVIDIA, pas de nvidia-smi) | GPU NVIDIA ≥18 Go | ❌ |
| RAM | 7,7 Go | ~20 Go même pour GGUF Q4 CPU | ❌ |
| Disque C: | 53 Go libres | ≥40 Go | ⚠️ juste |

**Conclusion : les étapes 0-2 s'exécutent sur la machine GPU de démo
uniquement.** Sur cette machine on ne fait que : le code des flags
(`WRITER_BACKEND`, `generate_diffusion()`), les tests unitaires sans modèle,
et la doc. Le téléchargement des poids (~15-20 Go) doit être lancé sur la
machine GPU dès qu'on y a accès — c'est le chemin critique.

## URLs (référence)
- Fiche modèle : https://huggingface.co/google/diffusiongemma-26B-A4B-it
- Docs Google : https://ai.google.dev/gemma/docs/diffusiongemma
- Inférence HF : https://ai.google.dev/gemma/docs/diffusiongemma/inference-diffusiongemma-with-hf
- Hackable Diffusion : https://github.com/google/hackable_diffusion
- Transformers doc : https://huggingface.co/docs/transformers/model_doc/diffusion_gemma
- NVIDIA RTX blog : https://blogs.nvidia.com/blog/rtx-ai-garage-local-gemma-diffusion/

## Décisions proposées (à valider par Taha)
1. Machine GPU : tester la piste Ollama-GGUF (15 min) → sinon WSL2+vLLM avec
   `RedHatAI/...-FP8-dynamic`.
2. Ici, pendant ce temps : implémenter `WRITER_BACKEND` + `generate_diffusion()`
   derrière flag (additif, zéro risque pour Tier 1-3), + centraliser le format
   de marqueur d'invariant en constante (préparation au test de survie ⟦⟧ vs [[]]).
3. Étape 2 microscope : n'y toucher qu'après 1.a-1.f validés sur GPU, kill-switch
   strict.

## FAIT sur cette machine (étape 1.c — code additif, 2026-07-04)

Le pipeline Ollama par défaut est **inchangé** (régression vérifiée). Tout est
derrière flags, désactivé par défaut :

| Flag | Défaut | Effet |
|---|---|---|
| `DIAL_WRITER_BACKEND` | `ollama` | `diffusion` → writer via endpoint OpenAI-compatible |
| `DIAL_DIFFUSION_BASE_URL` | `http://localhost:8001/v1` | vLLM dans WSL |
| `DIAL_DIFFUSION_MODEL` | `google/diffusiongemma-26B-A4B-it` | tag servi par vLLM |
| `DIAL_DIFFUSION_MAX_TOKENS` | `512` | 1-2 blocs de canvas 256 |
| `DIAL_DIFFUSION_N` | `1` | best-of-k (k>1 → sélection par survie des marqueurs) |
| `DIAL_INV_STYLE` | `unicode` | `ascii` → tout le pipeline passe de ⟦INV:id⟧ à [[INV:id]] |

- `llm.py::generate_diffusion()` — client `/chat/completions`, n choix, 1 retry,
  métriques `backend="diffusion"` dans `metrics.jsonl`.
- `orchestrator.py::_write()` — dispatch sur `WRITER_BACKEND` ; `_rewrite_preserving()`
  filtre les candidats best-of-k par survie des marqueurs scellés (l'audit Nemotron
  normal juge ensuite le candidat retenu). Sélection comparative par Nemotron
  (brief 1.c) : non implémentée — la survie des marqueurs + l'audit aval couvrent
  le besoin ; à revisiter sur GPU si le temps le permet.
- Marqueur centralisé dans `config.py` (`inv_token()`) — `invariants.py`,
  `prompts.py`, `orchestrator.py` le consomment. Bascule ascii testée
  (tokenize/verify/resolve round-trip OK).
- **Testé contre un mock vLLM** : candidat 0 casse un marqueur, candidat 1 le
  préserve → le 1 est sélectionné. Le vrai modèle n'a JAMAIS tourné ici (pas de
  GPU) : les tests 1.d (survie ⟦⟧ réelle, verrouillage FR) restent à faire sur
  la machine GPU.

### Checklist machine GPU (dans l'ordre)
1. `ollama pull hf.co/unsloth/diffusiongemma-26B-A4B-it-GGUF:Q4_K_M` — si le
   sampler diffusion passe, `DIAL_WRITER_MODEL` suffit, ignorer WSL/vLLM.
2. Sinon : WSL2 + vLLM (`RedHatAI/...-FP8-dynamic`), puis
   `DIAL_WRITER_BACKEND=diffusion` et `curl http://localhost:8001/v1/models`.
3. Tests 1.d + 1.e en UNE commande (harnais `backend/abtest.py`) :
   ```bash
   DIAL_WRITER_BACKEND=diffusion python abtest.py ../samples/1_caf_letter.md \
       --audit --json abtest_diffusion.json
   ```
   → compare `seal_survival_first_try` / `language_lock` à la baseline Gemma3
   (`baseline_gemma3_cpu.json`, mesurée le 2026-07-04 sur la machine dev).
   Si survie < baseline → relancer avec `DIAL_INV_STYLE=ascii`.
   Dérive EN → renforcer le prompt système. Lecture manuelle de `plain`/`simple`
   en français reste obligatoire (le harnais mesure, il ne juge pas le style).
4. Preuve offline (1.f) : `HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1`, WiFi coupé.
5. Orchestration VRAM (1.b) : phases séquencées ou Nemotron sur CPU — documenter ici.

## Chasse au cas de stress (§8 du SPEC — indépendant de DiffusionGemma)

`samples/stress_candidates.md` : 5 clauses piégeuses (ne…que, silence-vaut-
acceptation, interdiction absolue, sauf-force-majeure). La chasse = les passer
au pipeline et repérer où Gemma dérive ET Nemotron flag `uncertain` :

```bash
python abtest.py ../samples/stress_candidates.md --audit --json abtest_stress.json
```

Puis lire les `rows` avec `audit=uncertain` et vérifier À LA MAIN que la dérive
est un vrai renversement d'obligation (pas un faux positif de l'auditeur). La
clause gagnante intègre le doc de démo de la vidéo. Ne pas truquer (SPEC §8).

### Résultats de chasse (2026-07-04, CPU)

**v1 (5 clauses, plain+simple, 10 jobs) : 10/10 faithful.** Gemma3 n'a renversé
aucune obligation sur les pièges de base. Bon signe produit, pas de moment-vidéo.

**Sondage de sensibilité Nemotron** (dérives écrites à la main vs clause
sous-location) :
- flip total → `uncertain` ✅ · perte « écrit et préalable » → `uncertain` ✅
- sanction adoucie → `uncertain` ✅
- **omission pure de la sanction → `faithful` ❌** (angle mort : les ajouts et
  altérations sont attrapés, les omissions silencieuses peuvent passer)

→ À reporter dans les « honest limitations » du README : l'audit attrape les
claims ajoutés/altérés ; les omissions de conséquences sont moins fiables.
C'est cohérent avec le positionnement « heuristic dual-model check, not a
formal guarantee ».

**v2 (4 clauses dures, plain+simple, 8 jobs) : 8/8 faithful côté Nemotron,
MAIS la lecture manuelle des textes (abtest_stress_v2.json) a trouvé :**

1. **BUG produit (corrigé)** : sur les paragraphes SANS invariant, Gemma
   hallucine des tokens `⟦INV:1⟧`/`⟦INV:x⟧` (le prompt système lui en apprend
   la syntaxe). `verify()` ne contrôlait que les ids attendus et `resolve()`
   rendait les ids inconnus tels quels → tokens bruts visibles dans le HTML.
   Fix : `invariants.strip_unknown()` — les ids inconnus sont des fabrications
   par construction, strippés déterministiquement avant vérification (branché
   dans `_rewrite_preserving` + `abtest.py`, 3 tests unitaires OK).
2. **Clause p3 = vraie dérive NON attrapée** : original « sauf opposition
   expresse [dans 15 jours], le bailleur est réputé autorisé à visiter » ;
   réécriture simple : « s'il n'est pas d'accord, il doit écrire […] Après
   cela, le propriétaire peut montrer l'appartement » — l'opposition DÉCLENCHE
   la visite au lieu de la bloquer. Nemotron : faithful. Confirme l'angle mort
   omissions/inversions subtiles.

**État de la chasse au moment-vidéo : piste chaude via changement d'auditeur.**

- Re-roll v2 : p3 inverse **systématiquement** (2/2, même mécanisme « Ensuite,
  le propriétaire peut montrer… ») et nemotron-mini la rate 2/2.
- Test comparatif sur la paire p3 (original vs réécriture dérivée) :
  - `nemotron-mini:latest` (4B) → **faithful** ❌
  - `llama3.1:8b` → **uncertain** ✅ (« implies permission rather than
    authorization ») — la capacité de l'auditeur est le facteur limitant.
- **`nemotron-3-nano:4b` testé (2026-07-04)** — modèle REASONING : il faut
  `think: false` sinon réponse vide (corrigé globalement dans `llm.py::_call_ollama` ;
  sans le fix, tout modèle reasoning branché aurait renvoyé du vide).
  Résultats : sondes courtes **4/4 attrapées** (y c. l'omission de sanction que
  mini rate) avec de bien meilleures raisons ; MAIS p3 (inversion longue) **ratée
  aussi** ; 1 faux positif discutable (p1). → meilleur que mini, pas suffisant
  pour le moment-vidéo.

### Matrice auditeurs (audits de la même batterie)

| Auditeur | p3 (dérive réelle) | Sondes courtes | Faux positifs (sur 2 sains) | Bonus NVIDIA |
|---|---|---|---|---|
| nemotron-mini (4B) | ❌ ratée | 3/4 (omission ratée) | 0 | ✅ |
| **nemotron-3-nano (4B)** | ❌ ratée | **4/4** | 1 discutable (raison substantielle) | ✅ |
| llama3.1:8b | ✅ attrapée | 4/4 | **2/2** (dont 1 pour du pur style) | ❌ |

**Verdict (matrice complète, 2026-07-04) :**
- llama3.1:8b attrape tout parce qu'il doute de tout → inutilisable (orange
  partout, la confiance §1.2 meurt). Sa capture de p3 ne compte pas : c'est de
  l'hypersensibilité, pas de la précision.
- **Recommandation : basculer `DIAL_AUDITOR_MODEL=nemotron-3-nano:4b`** —
  strictement meilleur que mini (4/4 sondes vs 3/4, raisons nettement plus
  précises), même empreinte, bonus NVIDIA conservé. Un faux positif discutable
  sur deux sains : à surveiller sur un doc complet avant la démo (une passe
  d'ingest de `1_caf_letter.md` suffit). C'est un changement d'env var, pas de
  code — décision Taha.
- **Moment-vidéo : toujours pas d'attrape propre.** Meilleure chance restante :
  `nemotron-3-nano:30b` sur la machine GPU (test unique : la paire p3, 2 min).
  Sinon, options honnêtes déjà listées (filmer le retry de scellé réel de la
  baseline, ou l'abstention « Auditor unavailable » qui a fonctionné en vrai).
