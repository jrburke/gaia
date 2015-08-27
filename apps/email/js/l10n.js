'use strict';
// These modules are "shimmed" and do not have any useful module export, just
// grab navigator.mozL10n
define(['l10nbase', 'l10ndate'], function() {

  navigator.mozL10n.once(function() {
window.performance.mark('l10n-after-once');
    // The html cache restore in html_cache_restore could have set the ltr
    // direction incorrectly. If the language goes from an RTL one to a LTR
    // one while the app is closed, this could lead to a stale value.
    var dir = navigator.mozL10n.language.direction,
        htmlNode = document.querySelector('html');

    if (htmlNode.getAttribute('dir') !== dir) {
      console.log('email l10n updating html dir to ' + dir);
      htmlNode.setAttribute('dir', dir);
    }
  });

  return navigator.mozL10n;
});
