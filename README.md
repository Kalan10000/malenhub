# ✌️ MalenHub

Un hub **3D en third person**. Tu es une main ✌️ qui marche sur une île flottante.
Chaque jeu du dossier `jeux/` a **un trou**. Tu sautes dedans → redirection vers le jeu.

## Ajouter un jeu

1. Glisse ton fichier `.html` dans `jeux/`
2. C'est tout. Le build fabrique la liste.

```bash
node build.js          # scan jeux/ -> games.json + dist/
```

Le `<title>` de ta page devient le nom affiché au-dessus du trou.
Un fichier qui commence par `_` ou `.` est ignoré (utile pour tester sans le publier).

## Lancer en local

```bash
npm run dev            # = node build.js --serve
# -> http://localhost:5173
```

Un petit serveur statique est inclus, zéro dépendance à installer.
(Ouvrir `index.html` en `file://` marche pour la 3D, mais pas pour le manifeste :
utilise le serveur.)

## Commandes

| | |
|---|---|
| `Z Q S D` / `W A S D` / `↑ ↓ ← →` | bouger (AZERTY + QWERTY) |
| `Espace` | sauter — et **viser un trou** quand tu es à côté |
| souris (glisser) / `Q` `E` | tourner la caméra |
| molette | zoom |
| `Echap` | pause |

Un trou ne peut jamais être « raté » : dès que tes pieds passent au-dessus, il
t aspire. Et tu peux simplement marcher dedans, pas besoin de sauter.

Sur mobile : stick virtuel à gauche, bouton `SAUT` à droite.

## Comment ça marche

`build.js` scanne `jeux/*.html` et écrit :

- `games.json` — le manifeste (lu par `fetch`)
- `games.js` — le même contenu en variable `window.MALEN_GAMES` (pas de CORS)
- `dist/` — le site complet, prêt à héberger

Au lancement, le hub compte les jeux et pose **exactement un trou par jeu**
(anneau régulier jusqu'à 11 jeux, puis spirale de Fibonacci). La liste suit donc
automatiquement `jeux/`.

Si tu ajoutes un jeu sans relancer le build, le hub affiche quand même le
nombre de trous correspondant — donc ne publie pas `dist/` sans build.

## Déployer

### Vercel

Import le dépôt. C'est déjà configuré dans `vercel.json` :

```json
{ "buildCommand": "node build.js", "outputDirectory": "dist" }
```

### GitHub Pages

Le workflow `.github/workflows/pages.yml` build et publie `dist/`.
Active **Settings → Pages → Source: GitHub Actions**.

### Partout ailleurs

`node build.js` puis héberge le dossier `dist/`.

## Structure

```
malenhub/
├─ index.html        hub
├─ favicon.svg
├─ css/style.css
├─ js/hub.js        monde, contrôles, physique, redirection
├─ js/hand.js       la main ✌️ (générée en code, aucun asset)
├─ jeux/            ← tes jeux ici
├─ build.js         scan + build + petit serveur
├─ games.json/js    générés, dans .gitignore
└─ dist/            généré, dans .gitignore
```

## Personnaliser

Tout est dans `CFG` en haut de `js/hub.js` :
vitesse, gravité, saut, taille des trous, distance entre trous, caméra.

```js
holeR: 1.75,        // rayon d'un trou
holeSpacing: 5.4,   // écart entre deux trous
jumpV: 9.6,         // hauteur du saut
magnet: 40,         // attraction d'un trou : impossible de le dépasser
```

Les couleurs des trous sont générées automatiquement (teintes réparties).
Le décompte et les noms affichés dans le menu se remplissent tout seuls.
