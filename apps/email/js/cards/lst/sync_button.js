'use strict';
define(function(require) {

return [
  require('../mixins/data-dclick'),

  require('../base_render')(['folder'], function(html) {
    var folder = this.state.folder;
    if (!folder) {
      return;
    }

    //todo: consder effects of .syncBlocked when implemented on back end.
    var syncing = folder.syncStatus === 'pending' ||
                  folder.syncStatus === 'active';

    // You can't refresh messages in the localdrafts folder.
    var collapsed = folder.type === 'localdrafts' ? 'collapsed' : '';

    var state, role, l10nId;
    if (syncing) {
      state = 'synchronizing';
      role = 'progressbar';
      l10nId = 'messages-refresh-progress';
    } else {
      state = 'synchronized';
      role = '';
      l10nId = 'messages-refresh-button';
    }

    var disabled = folder.type === 'outbox' ? 'disabled' : '';

    html`<button data-dclick="onRefresh"
            class="icon msg-refresh-btn ${collapsed}"
            ${disabled}
            data-state="${state}"
            data-l10n-id="${l10nId}">
    </button>`;
  }),

  {
    onRefresh: function() {

      var folder = this.state.folder;

      // If this is the outbox, refresh has a different meaning.
      if (folder.type === 'outbox') {
        // Rather than refreshing the folder, we'll send the pending
        // outbox messages, and spin the refresh icon while doing so.
//todo: need to do something differnet here. Can msg_vscroll just handle this,
//by listening to changes to the folder?
        this.toggleOutboxSyncingDisplay(true);
      } else {
        // Normal folder.
        var status = folder.syncStatus;
        if (status !== 'pending' && status !== 'active') {
          console.error('figure out how should listCursor.list.refresh(); ' +
                        'should be called');
        }

      //todo: revist once folder.syncBlocked is available
      // If we failed to talk to the server, then let's only do a refresh if
      // we know about any messages.  Otherwise let's just create a new slice
      // by forcing reentry into the folder.
      // case 'syncfailed':
      //   if (listCursor.list.items.length) {
      //     listCursor.list.refresh();
      //   } else {
      //     this.showFolder(folder, /* force new slice */ true);
      //   }
      //   break;
      // }
      }

      // Even if we're not actually viewing the outbox right now, we
      // should still attempt to sync any pending messages. It's fairly
      // harmless to kick off this job here, but it could also make
      // sense to do this at the backend level. There are a number of
      // cases where we might also want to  sendOutboxMessages() if
      // we follow up with a more comprehensive sync setting -- e.g. on
      // network change, on app startup, etc., so it's worth revisiting
      // this and how coupled we want incoming vs outgoing sync to be.
      this.model.api.sendOutboxMessages(this.model.account);
    }
  }
];

});
