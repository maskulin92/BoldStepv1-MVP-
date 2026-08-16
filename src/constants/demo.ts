/**
 * Demo hints surfaced in the UI while the app runs in mock mode.
 *
 * These are NOT credentials for any real account — they exist only for the
 * seeded in-memory dataset, and the components that show them are gated on the
 * server-reported `mock_mode` flag. As soon as Firebase Admin credentials are
 * present, mock mode is off and none of this renders.
 */
export const DEMO_PIN_HINTS: Record<string, string> = {
  'nova-dental': '123456',
  'zafran-property': '234567',
  'kasih-tuition': '345678',
  'boldstep-house': '999999',
};

export const DEMO_CLIENT_LINKS = [
  { link_id: 'nova-dental', name: 'Nova Dental Clinic' },
  { link_id: 'zafran-property', name: 'Zafran Property' },
  { link_id: 'kasih-tuition', name: 'Kasih Tuition Centre' },
];
