// Brainrot catalog: maps the FBX character assets to display names,
// rarity tiers, income rates and purchase prices.

export interface RarityDef {
  id: string;
  label: string;
  color: string;       // hex css color for UI / nameplates
  weight: number;      // spawn weighting on the conveyor
  incomePerSec: number;
  price: number;
  scale: number;       // normalized world height of the character
}

export const RARITIES: RarityDef[] = [
  { id: 'common',    label: 'Common',    color: '#b8b8b8', weight: 38, incomePerSec: 1,   price: 25,   scale: 1.25 },
  { id: 'rare',      label: 'Rare',      color: '#4da6ff', weight: 26, incomePerSec: 4,   price: 110,  scale: 1.45 },
  { id: 'epic',      label: 'Epic',      color: '#b366ff', weight: 17, incomePerSec: 12,  price: 350,  scale: 1.65 },
  { id: 'legendary', label: 'Legendary', color: '#ffb84d', weight: 11, incomePerSec: 35,  price: 1000, scale: 1.9 },
  { id: 'mythic',    label: 'Mythic',    color: '#ff4d6d', weight: 6,  incomePerSec: 90,  price: 2800, scale: 2.15 },
  { id: 'secret',    label: 'Secret',    color: '#1aff8c', weight: 2,  incomePerSec: 250, price: 8000, scale: 2.45 },
];

export interface BrainrotDef {
  id: string;
  name: string;
  file: string; // url under /assets
}

export const BRAINROTS: BrainrotDef[] = [
  { id: 'avocado',  name: 'Avocadini Gorillini', file: 'assets/AvocadoGorilla_Merged_Animations.fbx' },
  { id: 'ballerina', name: 'Ballerina Cappuccina', file: 'assets/BallerinaMerged_Animations.fbx' },
  { id: 'patapim',  name: 'Brr Brr Patapim',      file: 'assets/BrrBrrPatapim_Merged_Animations.fbx' },
  { id: 'jobjob',   name: 'Job Job Job Sahur',    file: 'assets/JobJobMerged_Animations.fbx' },
  { id: 'segnora',  name: 'La Segnora Bombardina', file: 'assets/segnoraMerged_Animations.fbx' },
  { id: 'sixseven', name: 'Six Seven',            file: 'assets/sixsevenMerged_Animations.fbx' },
];

export function rollRarity(rng: () => number = Math.random): RarityDef {
  const total = RARITIES.reduce((s, r) => s + r.weight, 0);
  let pick = rng() * total;
  for (const r of RARITIES) {
    pick -= r.weight;
    if (pick <= 0) return r;
  }
  return RARITIES[0];
}

export function rollBrainrot(rng: () => number = Math.random): BrainrotDef {
  return BRAINROTS[Math.floor(rng() * BRAINROTS.length)];
}

export function formatMoney(n: number): string {
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 10_000) return '$' + (n / 1000).toFixed(1) + 'K';
  return '$' + Math.floor(n).toLocaleString();
}
