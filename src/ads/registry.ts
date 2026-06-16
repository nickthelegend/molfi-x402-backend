export interface Ad {
  id: string;
  mp4Url: string;
  durationMs: number;
  advertiser: string;
  credits: number;
}

export const ADS_REGISTRY: Ad[] = [
  {
    id: 'avax-subnets',
    mp4Url: '/ads/avax_subnets.mp4',
    durationMs: 15000,
    advertiser: 'Avalanche Foundation',
    credits: 5,
  },
  {
    id: 'circle-devs',
    mp4Url: '/ads/circle_devs.mp4',
    durationMs: 15000,
    advertiser: 'Circle',
    credits: 5,
  },
  {
    id: 'molfi-premium',
    mp4Url: '/ads/molfi_premium.mp4',
    durationMs: 15000,
    advertiser: 'Molfi Labs',
    credits: 5,
  },
];
