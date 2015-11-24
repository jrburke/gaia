define(function(require) {
'use strict';

var defaultVScrollData = require('./default_vscroll_data'),
    MessageListTopBar = require('message_list_topbar'),
    selectOwnElements = require('../mixins/select_own_elements');

return [
  require('../base_render')(['this.listCursor'], function(html) {
    if (!this.state.listCursor) {
      return;
    }

    html`
    <!-- exists so we can force a minimum height -->
    <div class="msg-list-scrollinner">
      <data-slot data-slot-id="headerElement"></data-slot>
      <lst-msg-vscroll data-prop="msgVScroll"
                       aria-label="${this.listAriaLabel}"
                       data-empty-l10n-id="${this.emptyListL10nId}">
      </lst-msg-vscroll>
    </div>

    <!-- New email notification bar -->
    <div class="message-list-topbar"></div>
    `;
  }),

  {
    createdCallback: function() {
      // This is set by the custom element that owns this element.
      this.editController = null;

      // If this is a cached content, hold on to the slotted IDs.
      if (this.dataset.cached === 'cached') {
        selectOwnElements('[data-slot-id]', this, (element) => {
          var slotId = element.dataset.slotId;
          var slots = this.slots || (this.slots = {});
          slots[slotId] = element;
        });
      }
    },

    renderEnd: function() {
      if (!this.state.listCursor) {
        return;
      }

      // If the headerElement cares about the scroll area, then also tell it
      // the scrollContainer to use.
      var headerElement = this.slots.headerElement;
      if (headerElement.scrollAreaInitialized) {
        headerElement.scrollContainer = this;
      }

      this.onceDomEvent(this.msgVScroll, 'messagesSeekEnd',
                        this.scrollAreaInitialized.bind(this));

      var vScrollBindData = (model, node) => {
        model.element = node;
        node.message = model;
        this.updateMessageDom(model);
      };

      this.msgVScroll.init(this,
                           vScrollBindData,
                           defaultVScrollData,
                           this.itemTemplateNode);

      this.msgVScroll._needVScrollData = true;
      this.msgVScroll.on('syncComplete', this, 'onSyncComplete');

      this.msgVScroll.setListCursor(this.state.listCursor, this.model);

      // For search we want to make sure that we capture the screen size prior
      // to focusing the input since the FxOS keyboard will resize our window to
      // be smaller which messes up our logic a bit.  We trigger metric
      // gathering in non-search cases too for consistency.
      this.msgVScroll.vScroll.captureScreenMetrics();

      // Once the real render is called, this element is already in the DOM,
      // so can do the DOM calculations.
      this.setHeaderElementHeight();
      this.msgVScroll.vScroll.nowVisible();

      // Create topbar. Do this **after** calling init on msgVScroll.
      this.topBar = new MessageListTopBar(
        this.querySelector('.message-list-topbar')
      );
      this.topBar.bindToElements(this,
                                  this.msgVScroll.vScroll);
      // Also tell the MessageListTopBar about vScroll offset.
      this.topBar.visibleOffset = this.msgVScroll.vScroll.visibleOffset;
    },

    nowVisible: function() {
      if (this._whenVisible) {
        var fn = this._whenVisible;
        this._whenVisible = null;
        fn();
      }
    },

    // The syncComplete event will be generated whenever a sync occurs in
    // whatever is backing our current list view.  This occurs regardless of our
    // virtual scroll position.  It's called a newish count because it covers
    // both entirely new conversations and conversations that had a new
    // message added to them.  (And this occurs for all folders.  Not just the
    // inbox, as was the pre-convoy case.  When we get search filters and
    // unified folders, this will also notify for them too with sane semantics.)
    onSyncComplete: function({ newishCount, thisViewTriggered }) {
      if (newishCount > 0) {
        if (!cards.isVisible(this)) {
          // todo: think about this more deeply and/or document the expected
          // scenario when this would occur.  The back-end can provide stickier
          // information if desired.
          this._whenVisible = this.onSyncComplete.bind(this, { newishCount });
          return;
        }

        // If the user manually synced, then want to jump to show the new
        // messages. Otherwise, show the top bar.
        if (thisViewTriggered) {
          this.msgVScroll.vScroll.jumpToIndex(0);
        } else {
          // Update the existing status bar.
          this.topBar.showNewEmailCount(newishCount);
        }
      }
    },

    setHeaderElementHeight: function() {
      // Get the height of the top element and tell vScroll about it.
      this.msgVScroll.vScroll.visibleOffset =
                              this.slots.headerElement.offsetHeight;
    },

    scrollAreaInitialized: function() {
      if (this.slots.headerElement.scrollAreaInitialized) {
        this.slots.headerElement.scrollAreaInitialized();
      }
    }
  }
];

});
