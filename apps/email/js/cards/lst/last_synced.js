'use strict';
define(function(require) {

var date = require('date');

return [
  require('../base_render')(['folder'], function(html) {
    // BIG ASUTH NOTE!
    // The WindowedListView's tocMeta can now provide all of
    // lastSuccessfulSyncAt, syncStatus, and syncBlocked information.  In
    // particular, lastSuccessfulSyncAt is magically latched to only update
    // when the syncComplete notification is generated after the entire task
    // group completes.  The one on the folder updates as part of the
    // sync_refresh task, which can be more confusing.
    //
    // BUT, the tocMeta currently does not provide localUnreadConversations.
    // The rationale was that it could be hard/expensive to provide it as a
    // summary statistic in all cases, namely search-on-server, so it might
    // be better to (at least for now) treat the things in the header as
    // something the front-end is responsible for tracking.
    //
    // I've filed https://bugzilla.mozilla.org/show_bug.cgi?id=1241001 to
    // track the larger conceptual issue and discussion.  The bottom line for
    // this code here is that it could also be getting some of its data off of
    // the `tocMeta` if it wants.
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
