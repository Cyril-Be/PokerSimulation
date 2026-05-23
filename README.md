# PokerSimulation

Simulateur de poker Texas Hold'em (bots aléatoires) avec :

- gestion complète d'une main (préflop, flop, turn, river)
- actions valides : fold, check, call, raise, all-in
- mode simulation rapide (10/50/100/500/1000)
- mode automatique sur une donne
- mode pas-à-pas avec bouton **Suivant**
- affichage des probabilités estimées (complètes + information incomplète)
- gestion de la table : nombre de joueurs, reset, remplacement d'un joueur
- stratégies configurables (seuils, adaptatif, mimétisme, tight-agressive, GTO lite)
- statistiques détaillées :
  - graphique individuel (stack + probabilité + marqueurs all-in)
  - graphique global (pot total, pot moyen, argent global)
  - légendes et repères de mains sur les graphes
- historique des actions et classement des joueurs

## Lancer l'application

```bash
python3 -m http.server 8000
```

Puis ouvrir <http://localhost:8000>.

## Lancer les tests

```bash
node --test
```
