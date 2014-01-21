
'use strict';
define(function(require) {

  var element = require('element'),
      registry = {},
      deckId = 0,
      slice = Array.slice;

  function upgradeChild(node) {
    var moduleId = node.tagName.toLowerCase();
    require([moduleId], function(ctor) {
      element.upgrade(ctor);
    });
  }

  function cleanRegistry(node) {
    var id = 'id' + node.getAttribute('data-deckid'),
        deck = registry[id];
    if (deck) {
      deck.destroy();
      delete registry[id];
    }
  }

  return [
    require('classy'),
    {
      registry: registry,

      createdCallback: function(node, options) {
        options = options || {};

        this.id = deckId += 1;
        this.node = node || document.createElement('section');
        this.addClass(this.node, 'deck');

        registry['id' + this.id] = this;

        if (options.deckClass) {
          options.deckClass.split(' ').forEach(function(cls) {
            this.addClass(this.node, cls);
          }.bind(this));
        }

        this.cards = [];
        this.dialogs = {};
        this.handlers = {};
        this.cardIdCounter = 0;
        this.index = 0;

        this.node.setAttribute('data-deckid', this.id);

        // Track any cards in the DOM already.
        slice(this.node.children).forEach(function(node) {
          // Hack to help out until real document.register
          if (node.tagName.indexOf('-') !== -1) {
            upgradeChild(node);
          }

          var oldCardId = node.getAttribute('data-cardid');
          if (oldCardId) {
            oldCardId = parseInt(oldCardId, 10);
            // Rehydrated. Up internal ID to be past this ID.
            if (this.cardIdCounter < oldCardId) {
              this.cardIdCounter = oldCardId + 1;
            }
          } else {
            node.setAttribute('data-cardid', this.cardIdCounter += 1);
          }

          var indexSet;
          if (this.hasClass(node, 'card')) {
            this.cards.push(node);
            if (!indexSet && this.hasClass(node, 'center')) {
              // Choose the first "center" card. With menu/settings,
              // the
              indexSet = true;
              this.index = this.cards.length - 1;
            }
          }
        }.bind(this));
      },

      _onTransitionEnd: function() {
        var endNode, beginNodeDestroyed;

        // Do not pay attention to events that are not part of this deck.
        if (!this._animating) {
          return;
        }

        // Multiple cards can animate, so there can be multiple transitionend
        // events. Only do the end work when all have finished animating.
        if (this._transitionCount > 0) {
          this._transitionCount -= 1;
        }

        if (this._transitionCount === 0) {
          this._animating = false;

          if (this._deadNodes) {
            this._deadNodes.forEach(function(domNode) {
              if (domNode === this._beginNode) {
                beginNodeDestroyed = true;
              }

              // Destroy any decks in play, to be good event listener
              // and memory citizens
              slice(domNode.querySelectorAll('[data-deckid]'))
                .forEach(cleanRegistry);

              // This node could be a deck.
              cleanRegistry(domNode);

              // Clean up the DOM
              if (domNode.parentNode) {
                domNode.parentNode.removeChild(domNode);
              }

              // TODO? Implement removed from view component lifecycle
              // call here?
            }.bind(this));
            this._deadNodes = [];
          }

          // If a vertical overlay transition was disabled, if
          // current node index is an overlay, enable it again.
          endNode = this._endNode;
          if (endNode) {
            if (endNode.classList.contains('disabled-anim-vertical')) {
              this.removeClass(endNode, 'disabled-anim-vertical');
              this.addClass(endNode, 'anim-vertical');
            }
            if (this._endNodeEvent) {
              this.notify(this._endNodeEvent, endNode);
              this._endNodeEvent = null;
            }
          }

          this._beginNode = null;
          this._endNode = null;

          this._handleAfterTransition();
        }
      },

      _handleAfterTransition: function() {
        if (this._afterTransition) {
          var afterTransition = this._afterTransition;
          delete this._afterTransition;
          afterTransition.call(this);
        }
      },

      destroy: function() {
        Object.keys(this.handlers).forEach(function(evtName) {
          var obj = this.handlers[evtName];
          obj.node.removeEventListener(evtName, obj.fn, false);
        }.bind(this));
      },

      before: function(moduleId, options) {
        options = options || {};

        require(['element!' + moduleId], function(Mod) {
          var node = new Mod();
          node.options = options;
          this.node.insertBefore(node, this.cards[0]);
          this.cards.unshift(node);
          this.index += 1;
          this._afterTransition = this._preloadModules;
          options.direction = 'forward';
          this.nav(0, options);
        }.bind(this));
      },

      after: function(moduleId, options) {
        options = options || {};
        require(['element!' + moduleId], function(Mod) {
          var node = new Mod();
          node.options = options;
          this.node.appendChild(node);
          this.cards.push(node);
          options.direction = 'forward';
          this.nav(this.cards.length - 1, options);
        }.bind(this));
      }
    }
  ];
});
