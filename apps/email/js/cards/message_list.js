define(function(require, exports, module) {
'use strict';

var cards = require('cards'),
    date = require('date'),
    evt = require('evt'),
    itemTemplateNode = require('tmpl!./msg/message_item.html'),
    ListCursor = require('list_cursor'),
    messageDisplay = require('message_display'),
    mozL10n = require('l10n!'),
    toaster = require('toaster'),
    updatePeepDom = require('./lst/peep_dom').update;

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
  require('./base_render')(['this.model'], function(html) {
    if (!this.model) {
      return;
    }

    html`
    <!-- Non-search header -->
    <section data-prop="normalHeader"
             class="msg-list-header"
             data-statuscolor="default"
             role="region">
      <header>
        <!-- Unlike a generic back button that navigates to a different screen,
           folder list header button triggers the folders and settings overlay.
           Thus the screen reader user requires more context as to what
           activating the button would do. -->
        <a href="#" class="msg-folder-list-btn" data-event="click:onShowFolders"
           aria-expanded="false" aria-controls="cards-folder-picker"
           role="button" data-l10n-id="message-list-menu">
          <span class="icon icon-menu"></span>
        </a>
        <menu data-prop="headerMenuNode" type="toolbar" class="anim-opacity">
          <a href="#" class="msg-compose-btn" data-event="click:onCompose"
             data-l10n-id="message-list-compose">
            <span class="icon icon-compose"></span>
          </a>
        </menu>
        <h1 class="msg-list-header-folder-label header-label">
          <lst-folder-title data-model-args></lst-folder-title>
        </h1>
      </header>
    </section>

    <!-- Multi-edit state header -->
    <lst-edit-header data-prop="editHeader"
                           data-event="editHeaderClose"></lst-edit-header>
    <!-- Scroll region -->
    <lst-msg-vscroll-container class="msg-list-scrollouter"
                            data-prop="msgVScrollContainer"
                            data-pass-prop="=>updateMessageDom:updateMessageDom,
                                            itemTemplateNode,
                                            emptyListL10nId"
                            data-event="messagesSeekStart,messagesSeekEnd,
                            messagesChange,emptyLayoutShown,emptyLayoutHidden"
                            data-model-args>
      <lst-search-link data-slot-id="headerElement"></lst-search-link>
    </lst-msg-vscroll-container>

    <!-- Toolbar for non-multi-edit state -->
    <ul data-prop="normalToolbar" class="bb-tablist msg-list-action-toolbar"
        role="toolbar">
      <li role="presentation">
        <lst-sync-button data-model-args></lst-sync-button>
      </li>
      <li role="status" class="msg-last-sync">
        <lst-last-synced data-prop="lastSynced"
                               data-model-args></lst-last-synced>
      </li>
      <li role="presentation">
        <button data-prop="editBtn" data-event="click:setEditModeStart"
                class="icon msg-edit-btn" data-l10n-id="edit-button"></button>
      </li>
    </ul>

    <lst-edit-toolbar data-prop="editToolbar"
                      data-event="onArchiveMessages,onDeleteMessages,
                                  onStarMessages,onMarkMessagesRead,
                                  onMoveMessages">
    </lst-edit-toolbar>
    `;
  }),

  require('./lst/edit_controller'),
  require('./lst/msg_click'),
  require('./lst/message_list_cache'),
  {
    createdCallback: function() {
      this._emittedContentEvents = false;
      this.curFolder = null;
      evt.on('folderPickerClosing', this, 'onFolderPickerClosing');
    },

    onArgs: function(args) {
      var model = this.model = args.model;
      model.latest('folder', this, 'showFolder');
      // This event is generated by sync.js when it receives a sendStatus
      // notification and our app is already in the foreground so it's not
      // appropriate (per our UX) to use a system notification.
      model.on('uiForegroundSendStatus', this, 'onUiForegroundSendStatus');
    },

    itemTemplateNode,

    /**
     * Inform Cards to not emit startup content events, this card will trigger
     * them once data from back end has been received and the DOM is up to date
     * with that data.
     * @type {Boolean}
     */
    skipEmitContentEvents: true,

    // Passed to the msg_vscroll_container.
    emptyListL10nId: 'messages-folder-empty',

    onShowFolders: function() {
      cards.add('immediate', 'folder_picker', {
        model: this.model
      }).then(() => {
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
      if (this.curFolder === folder) {
        return;
      }
      this.curFolder = folder;

      // Now that a folder is available, enable edit mode toggling.
      this.editModeEnabled = true;

      this.editToolbar.updateDomFolderType(folder.type,
                                           this.model.accountUsesArchive());

      var listCursor = this.listCursor = new ListCursor();
      listCursor.bindToList(this.model.api.viewFolderConversations(folder));

      switch (folder.type) {
        case 'drafts':
        case 'localdrafts':
        case 'outbox':
        case 'sent':
          this.msgVScrollContainer.isIncomingFolder = false;
          break;
        default:
          this.msgVScrollContainer.isIncomingFolder = true;
          break;
      }

      this.msgVScrollContainer.listAriaLabel = folder.name;

      // Trigger model render for msgVScrollContainer.
      this.msgVScrollContainer.emit('listCursor', listCursor);

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

    // When an email is being sent from the app (and not from an outbox
    // refresh), we'll receive notification here. Play a sound and
    // raise a toast, if appropriate.
    onUiForegroundSendStatus: function(data) {
      // TODO: clean this all up, see
      //  https://bugzilla.mozilla.org/show_bug.cgi?id=1241348
      if (this.curFolder.type === 'outbox') {
        // todo: this should probably be addressed by listening to the folder
        // and/or WindowedListView.  back-end involvement required. see bug
        // above.
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
      this.msgVScrollContainer.nowVisible();
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
      var items = this.msgVScrollContainer.msgVScroll.getElementsByClassName(
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
        this.editBtn.disabled = this.msgVScrollContainer.msgVScroll.isEmpty();

        // Similarly, we must stop the refresh icons for each message
        // from rotating further. For instance, if we are offline, we
        // won't actually attempt to send any of those messages, so
        // they'll still have a spinny icon until we forcibly remove it.
        for (i = 0; i < items.length; i++) {
          items[i].classList.remove('msg-message-syncing-section-syncing');
        }
      }

//todo: this is not needed/valid any more?
      this.setRefreshState(syncing);
    },

    messagesChange: function(event) {
      var { message, index } = event;

      this.updateMessageDom(message);

      // Since the DOM change, cache may need to change.
      this._considerCacheDom(index, module.id);
    },

    /**
     * Update the state of the given DOM node.  Note that DOM nodes are reused
     * so you must ensure that this method cleans up any dirty state resulting
     * from any possible prior operation of this method.
     */
    updateMessageDom: function(message) {
      var msgNode = message.element;

      if (!msgNode) {
        return;
      }

      // If the placeholder data, indicate that in case VScroll
      // wants to go back and fix later.
      var classAction = message.isPlaceholderData ? 'add' : 'remove';
      msgNode.classList[classAction]('default-data');

      // ID is stored as a data- attribute so that it can survive
      // serialization to HTML for storing in the HTML cache, and
      // be usable before the actual data from the backend has
      // loaded, as clicks to the message list are allowed before
      // the back end is available. For this reason, click
      // handlers should use dataset.id when wanting the ID.
      msgNode.dataset.id = message.id;

      // some things only need to be done once
      var dateNode = msgNode.querySelector('.msg-message-date');
      var subjectNode = msgNode.querySelector('.msg-message-subject');
      var snippetNode = msgNode.querySelector('.msg-message-snippet');

      var listPerson;
      if (this.isIncomingFolder || this.is) {
        listPerson = message.authors[0];
      // XXX This is not to UX spec, but this is a stop-gap and that would
      // require adding strings which we cannot justify as a slipstream fix.
      } else if (message.to && message.to.length) {
        listPerson = message.to[0];
      } else if (message.cc && message.cc.length) {
        listPerson = message.cc[0];
      } else if (message.bcc && message.bcc.length) {
        listPerson = message.bcc[0];
      } else {
//todo: changed this for drafts, but is it ideal if isDraft is on the message?
        listPerson = message.authors[0];
      }

      var detailsNode = msgNode.querySelector('.msg-message-details-section');
      detailsNode.classList.toggle('draft', message.hasDrafts);

      // author
      listPerson.element =
        msgNode.querySelector('.msg-message-author');
      listPerson.onchange = updatePeepDom;
      listPerson.onchange(listPerson);

      // count, if more than one.
      var countNode = msgNode.querySelector('.msg-message-count'),
          accountCountContainer = msgNode
                                  .querySelector('.msg-message-author-count');
      if (message.messageCount > 1) {
        accountCountContainer.classList.add('multiple-count');
      } else {
        accountCountContainer.classList.remove('multiple-count');
      }
      mozL10n.setAttributes(countNode, 'message-header-conv-count', {
        n: message.messageCount
      });

      // date
      var dateTime = dateNode.dataset.time =
                     message.mostRecentMessageDate.valueOf();
      date.relativeDateElement(dateNode, dateTime);

      // subject
      messageDisplay.subject(msgNode.querySelector('.msg-message-subject'),
                            message);

      // attachments (can't change within a message but can change between
      // messages, and since we reuse DOM nodes...)
      var attachmentsNode = msgNode.querySelector('.msg-message-attachments');
      attachmentsNode.classList.toggle('msg-message-attachments-yes',
                                       message.hasAttachments);
      // snippet needs to be shorter if icon is shown
      snippetNode.classList.toggle('icon-short', message.hasAttachments);

//todo: want first one or first unread one? Can tidbits be read messages?
      // snippet
      var tidbit = message.messageTidbits[0];
      snippetNode.textContent = (tidbit && tidbit.snippet) || ' ';

      // update styles throughout the node for read vs unread
      msgNode.classList.toggle('unread', message.hasUnread);

      // star
      var starNode = msgNode.querySelector('.msg-message-star');

      starNode.classList.toggle('msg-message-star-starred', message.hasStarred);
      // subject needs to give space for star if it is visible
      subjectNode.classList.toggle('icon-short', message.hasStarred);

      // sync status
      var syncNode =
            msgNode.querySelector('.msg-message-syncing-section');

      // sendState is only intended for outbox messages, so not all
      // messages will have sendProblems defined.
      var sendState = message.sendProblems && message.sendProblems.state;

      syncNode.classList.toggle('msg-message-syncing-section-syncing',
                                sendState === 'sending');
      syncNode.classList.toggle('msg-message-syncing-section-error',
                                sendState === 'error');

      // Set the accessible label for the syncNode.
      if (sendState) {
        mozL10n.setAttributes(syncNode, 'message-message-state-' + sendState);
      } else {
        syncNode.removeAttribute('data-l10n-id');
      }

      // edit mode select state, defined in lst/edit_controller
      this.updateDomSelectState(msgNode, message);
    },

    release: function() {
      if (this.listCursor) {
        this.listCursor.die();
      }

      evt.removeObjectListener(this);
      this.model.removeObjectListener(this);
    }
  }
];
});
