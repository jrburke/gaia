/*global requirejs, TestUrlResolver */
'use strict';

/**
 * Version number for cache, allows expiring cache.
 * Set by build process. Set as a global because it
 * is also used in html_cache.js.
 */
window.HTML_CACHE_VERSION = '2';

// Set up loading of scripts, but only if not in tests, which set up their own
// config.
if (typeof TestUrlResolver === 'undefined') {
  requirejs.config({
    // waitSeconds is set to the default here; the build step rewrites it to 0
    // in build/email.build.js so that we never timeout waiting for modules in
    // production. This is important when the device is under super-low-memory
    // stress, as it may take a while for the device to get around to loading
    // things email needs for background tasks like periodic sync.
    waitSeconds: 7,
    baseUrl: 'js',
    paths: {
      l10nbase: '../shared/js/l10n',
      l10ndate: '../shared/js/l10n_date',
      style: '../style',
      shared: '../shared'
    },
     map: {
      '*': {
        'api': 'ext/main-frame-setup'
      }
    },
    shim: {
      l10ndate: ['l10nbase'],

      'shared/js/mime_mapper': {
        exports: 'MimeMapper'
      },

      'shared/js/notification_helper': {
        exports: 'NotificationHelper'
      },

      'shared/js/accessibility_helper': {
        exports: 'AccessibilityHelper'
      },

      'shared/js/gesture_detector': {
        exports: 'GestureDetector'
      }
    },
    config: {
      template: {
        tagToId: function(tag) {
           return tag.replace(/^cards-/, 'cards/')
                  .replace(/^lst-/, 'cards/lst/')
                  .replace(/^msg-/, 'cards/msg/')
                  .replace(/^cmp-/, 'cards/cmp/')
                  .replace(/-/g, '_');
        }
      },

      element: {
        idToTag: function(id) {
          return id.toLowerCase()
                 .replace(/^cards\/lst\//, 'lst-')
                 .replace(/^cards\/msg\//, 'msg-')
                 .replace(/^cards\/cmp\//, 'cmp-')
                 .replace(/[^a-z]/g, '-');
        }
      }
    }
  });
}

// Tell audio channel manager that we want to adjust the notification channel if
// the user press the volumeup/volumedown buttons in Email.
if (navigator.mozAudioChannelManager) {
  navigator.mozAudioChannelManager.volumeControlChannel = 'notification';
}

// Run the app module, bring in fancy logging
window.performance.mark('requirejs-console,mail_app');
requirejs(['console_hook', 'mail_app']);
