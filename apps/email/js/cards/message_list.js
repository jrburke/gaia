'use strict';

define(function(require, exports, module) {

var cards = require('cards'),
    evt = require('evt'),
    toaster = require('toaster');

/**
 * List messages for listing the contents of folders. Multi-editing is just a
 * state of the card.
 *
 * == Cache behavior ==
 *
 * This is a card that can be instantiated using the cached HTML stored by the
 * html_cache. As such, it is constructed to allow clicks on message list items
 * before the back end has loaded up, and to know how to refresh the cached
 * state by looking at the use the usingCachedNode property. It also prevents
 * clicks from button actions that need back end data to complete if the click
 * would result in a card that cannot also handle delayed back end startup.
 *
 * == Less-than-infinite scrolling ==
 *
 * A dream UI would be to let the user smoothly scroll through all of the
 * messages in a folder, syncing them from the server as-needed.  The limits
 * on this are 1) bandwidth cost, and 2) storage limitations.
 *
 * Our sync costs are A) initial sync of a time range, and B) update sync of a
 * time range.  #A is sufficiently expensive that it makes sense to prompt the
 * user when we are going to sync further into a time range.  #B is cheap
 * enough and having already synced the time range suggests sufficient user
 * interest.
 *
 * So the way our UI works is that we do an infinite-scroll-type thing for
 * messages that we already know about.  If we are on metered bandwidth, then
 * we require the user to click a button in the display list to sync more
 * messages.  If we are on unmetered bandwidth, we will eventually forego that.
 * (For testing purposes right now, we want to pretend everything is metered.)
 * We might still want to display a button at some storage threshold level,
 * like if the folder is already using a lot of space.
 *
 * See `onScroll` for more details.
 *
 * XXX this class wants to be cleaned up, badly.  A lot of this may want to
 * happen via pushing more of the hiding/showing logic out onto CSS, taking
 * care to use efficient selectors.
 *
 */
return [
  require('./base_card')(require('template!./message_list.html')),
  require('./lst/edit_controller'),
  require('./mixins/data-model-args'),
  require('./mixins/data-pass-prop'),
  require('./lst/message_list_cache'),
  {
    createdCallback: function() {
      this._emittedContentEvents = false;

//todo: listen to some event for new email notifications, and do:
//    this.onNewMail(newEmailCount);

      evt.on('folderPickerClosing', this, 'onFolderPickerClosing');
    },

    onArgs: function(args) {
      var model = this.model = args.model;
      model.latest('folder', this, 'showFolder');
      model.on('newInboxMessages', this, 'onNewMail');
      model.on('backgroundSendStatus', this, 'onBackgroundSendStatus');
    },

    /**
     * Inform Cards to not emit startup content events, this card will trigger
     * them once data from back end has been received and the DOM is up to date
     * with that data.
     * @type {Boolean}
     */
    skipEmitContentEvents: true,

    onShowFolders: function() {
      cards.add('immediate', 'folder_picker', {
        model: this.model
      }).then((domNode) => {
        this.headerMenuNode.classList.add('transparent');
      });
    },

    onCompose: function() {
      cards.add('animate', 'compose', {
        model: this.model
      });
    },

    /**
     * Show a folder, returning true if we actually changed folders or false if
     * we did nothing because we were already in the folder.
     */
    showFolder: function(folder) {

      // Now that a folder is available, enable edit mode toggling.
      this.editModeEnabled = true;

      this.editToolbar.updateDomFolderType(folder.type,
                                           this.model.accountUsesArchive());

      this.onFolderShown();
    },

    /**
     * This is an override of setEditMode in lst/edit_controller because the
     * outbox needs special treatment.
     */
    setEditMode: function(editMode) {
      // Do not bother if edit mode is not enabled yet.
      if (!this.editModeEnabled) {
        return;
      }

      if (this.model.folder.type === 'outbox') {
        // You cannot edit the outbox messages if the outbox is syncing.
        if (editMode && this.outboxSyncInProgress) {
          return;
        }

        // Outbox Sync and Edit Mode are mutually exclusive. Disable
        // outbox syncing before allowing us to enter edit mode, and
        // vice versa. The callback shouldn't take long, but we wait to
        // trigger edit mode until outbox sync has been fully disabled,
        // to prevent ugly theoretical race conditions.
        var model = this.model;
        model.api.setOutboxSyncEnabled(model.account, !editMode, () => {
          this._setEditMode(editMode);
        });
      } else {
        this._setEditMode(editMode);
      }
    },

    //todo: what to do here, now that msg_vscroll_folder has topBar too.
    onNewMail: function(newEmailCount) {
      var folder = this.model.folder;

      if (folder.type === 'inbox' && newEmailCount && newEmailCount > 0) {
        if (!cards.isVisible(this)) {
          this._whenVisible = this.onNewMail.bind(this, newEmailCount);
          return;
        }

        // If the user manually synced, then want to jump to show the new
        // messages. Otherwise, show the top bar.
        if (this._manuallyTriggeredSync) {
          this.msgVScrollFolder.msgVScroll.vScroll.jumpToIndex(0);
        } else {
          // Update the existing status bar.
          this.topBar.showNewEmailCount(newEmailCount);
        }
      }
    },

    // When an email is being sent from the app (and not from an outbox
    // refresh), we'll receive notification here. Play a sound and
    // raise a toast, if appropriate.
    onBackgroundSendStatus: function(data) {
      if (this.model.folder.type === 'outbox') {
        if (data.state === 'sending') {
          // If the message is now sending, make sure we're showing the
          // outbox as "currently being synchronized".
          this.toggleOutboxSyncingDisplay(true);
        } else if (data.state === 'syncDone') {
          this.toggleOutboxSyncingDisplay(false);
        }
      }

      if (data.emitNotifications) {
        toaster.toast({
          text: data.localizedDescription
        });
      }
    },

    /**
     * Called when the folder picker is animating to close. Need to
     * listen for it so this card can animate fading in the header menu.
     */
    onFolderPickerClosing: function() {
      this.headerMenuNode.classList.remove('transparent');
    },

    /**
     * Listener called when a folder is shown. The listener emits an
     * 'inboxShown' for the current account, if the inbox is really being shown
     * and the app is visible. Useful if periodic sync is involved, and
     * notifications need to be closed if the inbox is visible to the user.
     */
    onFolderShown: function() {
      var model = this.model,
          account = model.account,
          folder = model.folder;

      // The extra checks here are to allow for lazy startup when we might have
      // a card instance but not a full model available. Once the model is
      // available though, this method will get called again, so the event
      // emitting is still correctly done in the lazy startup case.
      if (!document.hidden && account && folder) {
        if (folder.type === 'inbox') {
          evt.emit('inboxShown', account.id);
        }
      }
    },

    /**
     * An API method for the cards infrastructure, that Cards will call when the
     * page visibility changes and this card is the currently displayed card.
     */
    onCurrentCardDocumentVisibilityChange: function(hidden) {
      if (!hidden) {
        this.onFolderShown();
      }
    },

    /**
     * Called by Cards when the instance of this card type is the
     * visible card.
     */
    onCardVisible: function() {
      if (this._whenVisible) {
        var fn = this._whenVisible;
        this._whenVisible = null;
        fn();
      }

      this.lastSynced.nowVisible();
    },

    // Listener for msg_vscroll event.
    messagesSeekStart: function() {
      this._clearCachedMessages();
    },

    // Listener for msg_vscroll event.
    messagesSeekEnd: function(event) {
      var { index, totalCount } = event.detail;

      // Only cache if it is an add or remove of items
      if (totalCount) {
        this._considerCacheDom(
          index,
          module.id
        );
      }

      // Inform that content is ready. There could actually be a small delay
      // with vScroll.updateDataBind from rendering the final display, but it
      // is small enough that it is not worth trying to break apart the design
      // to accommodate this metrics signal.
      if (!this._emittedContentEvents) {
        evt.emit('metrics:contentDone');
        this._emittedContentEvents = true;
      }
    },

    // Listener for msg_vscroll event.
    messagesChange: function(event) {
      var { index } = event;

      // Since the DOM change, cache may need to change.
      this._considerCacheDom(index, module.id);
    },

    // Listener for msg_vscroll event.
    emptyLayoutShown: function() {
      this._clearCachedMessages();
      this.editBtn.disabled = true;

      this.scrollAreaInitialized();
    },

    // Listener for msg_vscroll event.
    emptyLayoutHidden: function() {
      this.editBtn.disabled = false;
    },

    //todo: test this, might need to do more here. Binds to
    //this.listCursor.on('messageSuidNotFound',
    //                   this.listNavOnMessageSuidNotFound);
    listNavOnMessageSuidNotFound: function(messageSuid) {
      // If no message was found, then go back. This card
      // may have been created from obsolete data, like an
      // old notification for a message that no longer exists.
      // This stops atTop since the most likely case for this
      // entry point is either clicking on a message that is
      // at the top of the inbox in the HTML cache, or from a
      // notification for a new message, which would be near
      // the top.
      if (this.messageSuid === messageSuid) {
        this.onBack();
      }
    },

    /**
     * The outbox has a special role in the message_list, compared to
     * other folders. We don't expect to synchronize the outbox with the
     * server, but we do allow the user to use the refresh button to
     * trigger all of the outbox messages to send.
     *
     * While they're sending, we need to display several spinny refresh
     * icons: One next to each message while it's queued for sending,
     * and also the main refresh button.
     *
     * However, the outbox send operation doesn't happen all in one go;
     * the backend only fires one 'sendOutboxMessages' at a time,
     * iterating through the pending messages. Fortunately, it notifies
     * the frontend (via `onBackgroundSendStatus`) whenever the state of
     * any message changes, and it provides a flag to let us know
     * whether or not the outbox sync is fully complete.
     *
     * So the workflow for outbox's refresh UI display is as follows:
     *
     * 1. The user taps the "refresh" button. In response:
     *
     *    1a. Immediately make all visible refresh icons start spinning.
     *
     *    1b. Immediately kick off a 'sendOutboxMessages' job.
     *
     * 2. We will start to see send status notifications, in this
     *    class's onBackgroundSendStatus notification. We listen to
     *    these events as they come in, and wait until we see a
     *    notification with state === 'syncDone'. We'll keep the main
     *    refresh icon spinning throughout this process.
     *
     * 3. As messages send or error out, we will receive slice
     *    notifications for each message (handled here in `messages_change`).
     *    Since each message holds its own status as `header.sendProblems`,
     *    we don't need to do anything special; the normal rendering logic
     *    will reset each message's status icon to the appropriate state.
     *
     * But don't take my word for it; see `jobs/outbox.js` and
     * `jobmixins.js` in GELAM for backend-centric descriptions of how
     * the outbox sending process works.
     */
//todo: move to msg_vscroll?
    toggleOutboxSyncingDisplay: function(syncing) {
      // Use an internal guard so that we only trigger changes to the UI
      // when necessary, rather than every time, which could break animations.
      if (syncing === this._outboxSyncing) {
        return;
      }

      this._outboxSyncing = syncing;

//todo: would be good to avoid reaching into vscroll for this.
      var i;
      var items = this.msgVScrollFolder.msgVScroll.getElementsByClassName(
        'msg-message-syncing-section');

      if (syncing) {
        // For maximum perceived responsiveness, show the spinning icons
        // next to each message immediately, rather than waiting for the
        // backend to actually start sending each message. When the
        // backend reports back with message results, it'll update the
        // icon to reflect the proper result.
        for (i = 0; i < items.length; i++) {
          items[i].classList.add('msg-message-syncing-section-syncing');
          items[i].classList.remove('msg-message-syncing-section-error');
        }

        this.editBtn.disabled = true;
      } else {
        // After sync, the edit button should remain disabled only if
        // the list is empty.
//todo: would be good to avoid reaching into vscroll for this.
        this.editBtn.disabled = this.msgVScrollFolder.msgVScroll.isEmpty();

        // Similarly, we must stop the refresh icons for each message
        // from rotating further. For instance, if we are offline, we
        // won't actually attempt to send any of those messages, so
        // they'll still have a spinny icon until we forcibly remove it.
        for (i = 0; i < items.length; i++) {
          items[i].classList.remove('msg-message-syncing-section-syncing');
        }
      }
    },

    release: function() {
      evt.removeObjectListener(this);
      this.model.removeObjectListener(this);
    }
  }
];
});
