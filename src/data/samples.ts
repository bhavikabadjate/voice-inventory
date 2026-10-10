// A few everyday items so a new shop can try voice questions straight away.

import type { Product } from '@/core/billing';

export const SAMPLE_PRODUCTS: Omit<Product, 'id'>[] = [
  { names: ['Milk', 'dudh', 'doodh', 'दूध'], unit: 'l', sellPaise: 5600, costPaise: 4800, stock: 20 },
  { names: ['Sugar', 'cheeni', 'sakhar', 'चीनी', 'साखर'], unit: 'kg', sellPaise: 4400, costPaise: 4000, stock: 50 },
  { names: ['Ragi', 'nachni', 'नाचणी', 'रागी'], unit: 'kg', sellPaise: 8000, costPaise: 6500, stock: 10 },
  { names: ['Atta', 'gehu atta', 'आटा', 'कणीक'], unit: 'kg', sellPaise: 4200, costPaise: 3600, stock: 40 },
  { names: ['Onion', 'kanda', 'pyaaz', 'प्याज', 'कांदा'], unit: 'kg', sellPaise: 3000, costPaise: 2400, stock: 25 },
  { names: ['Eggs', 'anda', 'ande', 'अंडा', 'अंडी'], unit: 'piece', sellPaise: 700, costPaise: 550, stock: 60 },
  { names: ['Parle-G', 'parle', 'biscuit'], unit: 'custom:packet', sellPaise: 1000, costPaise: 850, stock: 40 },
];
