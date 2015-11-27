'use strict';
define(function(require) {

var date = require('date');

return [
  require('../base_render')(['folder'], function(html) {
    var folder = this.state.folder;
    if (!folder) {
      return;
    }

    this.lastSync = folder.lastSuccessfulSyncAt;

    var collapsed = !this.lastSync ? 'collapsed' : '';

    html`
    <span class="msg-last-synced-label ${collapsed}"
          data-l10n-id="folder-last-synced-label"></span>
    <span class="msg-last-synced-value"></span>
    `;
  }),
  {
    renderEnd: function() {
      if (!this.state.folder) {
        return;
      }

      var lastSyncedNode = this.querySelector('.msg-last-synced-value');
      date.setPrettyNodeDate(lastSyncedNode, this.lastSync);
      this.sizeLastSync();
    },

    nowVisible: function() {
      if (!this.innerHTML) {
        return;
      }

      // On first construction, or if done in background,
      // this card would not be visible to do the last sync
      // sizing so be sure to check it now.
      this.sizeLastSync();
    },

    /**
     * If the last synchronised label is more than half the length
     * of its display area, set a "long" style on it that allows
     * different styling. But only do this once per card instance,
     * the label should not change otherwise.
     * TODO though, once locale changing in app is supported, this
     * should be revisited.
     */
    sizeLastSync: function() {
      var label = this.querySelector('.msg-last-synced-label');
      if (label.scrollWidth) {
        var overHalf = label.scrollWidth > label.parentNode.clientWidth / 2;
        label.parentNode.classList[(overHalf ? 'add' : 'remove')]('long');
      }
    }
  }
];

});
