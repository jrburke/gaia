'use strict';
define(function(require) {

var FontSizeUtils = require('font_size_utils');

return [
  require('../base_render')(['folder'], function(html) {
    var folder = this.state.folder;
    if (!folder) {
      return;
    }

    var unreadCount = folder.localUnreadConversations;

    html`<span dir="auto"
            class="msg-list-header-folder-name">${folder.name}</span>`;

    if (unreadCount) {
      if (unreadCount > 999) {
        html`<span data-l10n-id="messages-folder-unread-max"
                class="msg-list-header-folder-unread"></span>`;
      } else {
        html`<span class="msg-list-header-folder-unread">${unreadCount}</span>`;
      }
    }
  }),

  {
    renderEnd: function() {
      requestAnimationFrame(() => {
        FontSizeUtils._reformatHeaderText(this);
      });
    }
  }
];

});
