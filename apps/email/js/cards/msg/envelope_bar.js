/*global MozActivity */
'use strict';

define(function(require, exports) {

var cards = require('cards'),
    Marquee = require('marquee'),
    msgContactMenuNode = require('tmpl!./contact_menu.html'),
    msgPeepBubbleNode = require('tmpl!./peep_bubble.html');

// This function exists just to avoid lint errors around
// "do not use 'new' for side effects.
function sendActivity(obj) {
  return new MozActivity(obj);
}

var contextMenuType = {
  VIEW_CONTACT: 1,
  CREATE_CONTACT: 2,
  ADD_TO_CONTACT: 4,
  REPLY: 8,
  NEW_MESSAGE: 16
};

return [
  require('../base')(require('template!./envelope_bar.html')),
  {
    createdCallback: function() {
      this.addEventListener('click', this.onEnvelopeClick.bind(this), false);
    },

    clear: function() {
      // Clear email addresses.
      Array.slice(this.querySelectorAll('.msg-peep-bubble')).forEach(
        function(node) {
          node.parentNode.removeChild(node);
        }
      );
    },

    setMessage: function(message) {
      this._message = message;
      var domNode = this;

      this.classList.toggle('draft', message.isDraft);

      // -- Header
      function updatePeep(peep) {
        var nameNode = peep.element.querySelector('.msg-peep-content');

        if (peep.type === 'from') {
          // We display the sender of the message's name in the header and the
          // address in the bubble.
          domNode.dispatchEvent(new CustomEvent('updateFromName', {
            detail: peep.name || peep.address
          }));

          nameNode.textContent = peep.address;
          nameNode.classList.add('msg-peep-address');
        }
        else {
          nameNode.textContent = peep.name || peep.address;
          if (!peep.name && peep.address) {
            nameNode.classList.add('msg-peep-address');
          } else {
            nameNode.classList.remove('msg-peep-address');
          }
        }
      }

      function addHeaderEmails(type, peeps) {
        var lineNode = domNode.querySelector('.msg-envelope-' + type + '-line');

        if (!peeps || !peeps.length) {
          lineNode.classList.add('collapsed');
          return;
        }

        // Make sure it is not hidden from a next/prev action.
        lineNode.classList.remove('collapsed');

        // Because we can avoid having to do multiple selector lookups, we just
        // mutate the template in-place...
        var peepTemplate = msgPeepBubbleNode;

        for (var i = 0; i < peeps.length; i++) {
          var peep = peeps[i];
          peep.type = type;
          peep.element = peepTemplate.cloneNode(true);
          peep.element.peep = peep;
          peep.onchange = updatePeep;
          updatePeep(peep);
          lineNode.appendChild(peep.element);
        }
      }

      addHeaderEmails('from', [message.author]);
      addHeaderEmails('to', message.to);
      addHeaderEmails('cc', message.cc);
      addHeaderEmails('bcc', message.bcc);
    },

    /**
     * Handle peep bubble click event and trigger context menu.
     */
    onEnvelopeClick: function(event) {
      var target = event.target;
      if (!target.classList.contains('msg-peep-bubble')) {
        return;
      }
      // - peep click
      this.onPeepClick(target);
    },

    onPeepClick: function(target) {
      var contents = msgContactMenuNode.cloneNode(true);
      var peep = target.peep;
      var headerNode = contents.getElementsByTagName('header')[0];
      // Setup the marquee structure
      Marquee.setup(peep.address, headerNode);

      // Activate marquee once the contents DOM are added to document
      document.body.appendChild(contents);
      // XXX Remove 'ease' if linear animation is wanted
      Marquee.activate('alternate', 'ease');

      // -- context menu selection handling
      var formSubmit = (evt) => {
        document.body.removeChild(contents);
        switch (evt.explicitOriginalTarget.className) {
          // All of these mutations are immediately reflected, easily observed
          // and easily undone, so we don't show them as toaster actions.
          case 'msg-contact-menu-new':
            cards.pushCard('compose', 'animate', {
              model: this.model,
              composerData: {
                message: this._message,
                onComposer: function(composer) {
                  composer.to = [{
                    address: peep.address,
                    name: peep.name
                  }];
                }
              }
            });
            break;
          case 'msg-contact-menu-view':
            sendActivity({
              name: 'open',
              data: {
                type: 'webcontacts/contact',
                params: {
                  'id': peep.contactId
                }
              }
            });
            break;
          case 'msg-contact-menu-create-contact':
            var params = {
              'email': peep.address
            };

            if (peep.name) {
              params.givenName = peep.name;
            }

            sendActivity({
              name: 'new',
              data: {
                type: 'webcontacts/contact',
                params: params
              }
            });

            // since we already have contact change listeners that are hooked up
            // to the UI, we leave it up to them to update the UI for us.
            break;
          case 'msg-contact-menu-add-to-existing-contact':
            sendActivity({
              name: 'update',
              data: {
                type: 'webcontacts/contact',
                params: {
                  'email': peep.address
                }
              }
            });

            // since we already have contact change listeners that are hooked up
            // to the UI, we leave it up to them to update the UI for us.
            break;
          case 'msg-contact-menu-reply':
            this._message.replyToMessage('sender').then((composer) => {
              cards.pushCard('compose', 'animate', {
                model: this.model,
                composer: composer
              });
            }).catch(function(err) {
              console.error(err);
            });
            break;
        }
        return false;
      };
      contents.addEventListener('submit', formSubmit);

      // -- populate context menu
      var contextMenuOptions = contextMenuType.NEW_MESSAGE;
      var messageType = peep.type;

      if (messageType === 'from') {
        contextMenuOptions |= contextMenuType.REPLY;
      }

      if (peep.isContact) {
        contextMenuOptions |= contextMenuType.VIEW_CONTACT;
      } else {
        contextMenuOptions |= contextMenuType.CREATE_CONTACT;
        contextMenuOptions |= contextMenuType.ADD_TO_CONTACT;
      }

      if (contextMenuOptions & contextMenuType.VIEW_CONTACT) {
        contents.querySelector('.msg-contact-menu-view')
          .classList.remove('collapsed');
      }
      if (contextMenuOptions & contextMenuType.CREATE_CONTACT) {
        contents.querySelector('.msg-contact-menu-create-contact')
          .classList.remove('collapsed');
      }
      if (contextMenuOptions & contextMenuType.ADD_TO_CONTACT) {
        contents.querySelector('.msg-contact-menu-add-to-existing-contact')
          .classList.remove('collapsed');
      }
      if (contextMenuOptions & contextMenuType.REPLY) {
        contents.querySelector('.msg-contact-menu-reply')
          .classList.remove('collapsed');
      }
      if (contextMenuOptions & contextMenuType.NEW_MESSAGE) {
        contents.querySelector('.msg-contact-menu-new')
          .classList.remove('collapsed');
      }
    }
  }
];

});
