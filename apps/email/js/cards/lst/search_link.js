define(function(require) {
'use strict';

return [
  require('../base_render')(function(html) {
    html`
    <!-- The search textbox hides under the lip of the messages.
         As soon as any typing happens in it, we push the search
         controls card. -->
    <form role="search" data-prop="searchBar"
          class="msg-search-tease-bar">
      <p>
        <input data-event="focus:onSearchButton"
               data-prop="searchTextTease"
               class="msg-search-text-tease" type="text"
               dir="auto"
               data-l10n-id="message-search-input" />
      </p>
    </form>
    `;
  }),

  {
    createdCallback: function() {
      // This is set by the owning container.
      this.scrollContainer = null;
    },

    renderEnd: function() {
      // If user tapped in search box before the JS for the card is attached,
      // then treat that as the signal to go to search. Only do this when first
      // starting up though.
      //todo: test this still works.
      if (document.activeElement === this.searchTextTease) {
        this.onSearchButton();
      }
    },

    onSearchButton: function() {
      // Do not bother if there is no current folder.
      if (!this.model || !this.model.folder) {
        return;
      }

      //todo: commented out until search is usable.
      require('not_implemented')('Search');
      // cards.add('animate', 'message_list_search', {
      //   model: this.model,
      //   folder: this.model.folder
      // });
    },

    scrollAreaInitialized: function() {
      // Hide the search box by scrolling it out of view.
      var scrollContainer = this.scrollContainer;

      // Search bar could have been collapsed with a cache load,
      // make sure it is visible, but if so, adjust the scroll
      // position in case the user has scrolled before this code
      // runs.
      if (this.classList.contains('collapsed')) {
        this.classList.remove('collapsed');
        scrollContainer.scrollTop += this.offsetHeight;
      }

      // Adjust scroll position now that there is something new in
      // the scroll region, but only if at the top. Otherwise, the
      // user's purpose scroll positioning may be disrupted.
      //
      // Note that when we call vScroll.clearDisplay() we
      // inherently scroll back up to the top, so this check is still
      // okay even when switching folders.  (We do not want to start
      // index 50 in our new folder because we were at index 50 in our
      // old folder.)
      if (scrollContainer.scrollTop === 0) {
        scrollContainer.scrollTop = this.offsetHeight;
      }
    }
  }
];

});
