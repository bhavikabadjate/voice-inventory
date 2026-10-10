// The app's four tabs, shared by the phone tab bar and the web navigation.

import type { IconName } from './ui';

export const TABS: { name: string; href: '/' | '/products' | '/khata' | '/shop'; title: string; icon: IconName }[] = [
  { name: 'index', href: '/', title: 'Ask', icon: { ios: 'mic.fill', md: 'mic' } },
  { name: 'products', href: '/products', title: 'Products', icon: { ios: 'shippingbox.fill', md: 'inventory_2' } },
  { name: 'khata', href: '/khata', title: 'Khata', icon: { ios: 'book.closed.fill', md: 'menu_book' } },
  { name: 'shop', href: '/shop', title: 'Shop', icon: { ios: 'storefront.fill', md: 'storefront' } },
];
