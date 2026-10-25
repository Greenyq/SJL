export const defaultRules = Object.freeze({ forwardMode: 'Either', goals: 3, assists: 3, combined: 3, wingerDuels: 2, passes: 4, defenderDuels: 5 });

export function taskScore(role, stats, rules = defaultRules) {
  const cap = (n, target) => Math.min(1, n / target);
  let completion;
  if (role === 'Forward') {
    const goal = cap(stats.goals, rules.goals), assist = cap(stats.assists, rules.assists);
    completion = rules.forwardMode === 'Both' ? (goal + assist) / 2
      : rules.forwardMode === 'Combined' ? cap(stats.goals + stats.assists, rules.combined)
      : Math.max(goal, assist);
  } else if (role === 'Winger') completion = (cap(stats.duels, rules.wingerDuels) + cap(stats.passes, rules.passes)) / 2;
  else if (role === 'Defender') completion = cap(stats.duels, rules.defenderDuels);
  else return { completion: null, rating: null };
  return { completion, rating: Math.round(completion * 100) / 10 };
}
