// GA4 Measurement IDs are public identifiers, not API secrets.
// Add the ID from Google Analytics → Admin → Data streams → Web.
window.FahCelAnalyticsConfig = {
  measurementId: 'G-703LHFFHQ3',
  // Keep preview/development visits out of production reports.
  allowedHosts: ['fahcel.eu', 'www.fahcel.eu']
};
