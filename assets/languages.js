// Keep the current section and campaign parameters when changing language.
// Links remain functional without JavaScript; translated content is static HTML.
document.querySelectorAll('.language-switcher a').forEach(function (link) {
  var target = new URL(link.href);
  target.search = window.location.search;
  target.hash = window.location.hash;
  link.href = target.href;
});
