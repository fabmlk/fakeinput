/*
 * Requirements: browser that implement:
 *  - W3C Working Draft Selection API: https://www.w3.org/TR/selection-api/
 *  - DOM Range from current Living Standard: https://dom.spec.whatwg.org/#ranges
 *
 * Lib tested on recent versions of Chrome & Firefox.
 *
 * Features not implemented:
 * - pressing a left or right arrow when text is selected
 * - dragging a selection beyond the left or right edge
 * - moving a selection around via click + dragging
 * - creating selection from keyboard: shift+arrow key or Ctrl+A
 * - outline styling on focus
 * - selectionchange event (not yet supported by browsers)
 */

(function (factory) {
    if (typeof define === "function" && define.amd) {
        // AMD. Register as an anonymous module.
        define([
            "jquery",
            "stylehelper"
        ], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node/CommonJS
        module.exports = factory(require("jquery"), require("stylehelper"));
    } else {
        // Browser globals
        factory(jQuery, StyleHelper);
    }
}(function ($, StyleHelper) {

    var $fakeCaret = $(); // only one care instance for everyone
    var nativeAPI = { // save native selector API
        querySelector: document.querySelector,
        querySelectorAll: document.querySelectorAll,
        matches: document.documentElement.matches,

        // jquery selector functions
        // TODO: provide an extension API to allow the user to define its own
        // overrides in order to handle any kind of third-party selector APIs
        jqFilter: $.fn.filter,
        jqFind: $.fn.find,
        jqNot: $.fn.not,
        jqIs: $.fn.is
    };

    function FakeInput() {
        this.defaults = {
            rightEdgeAdjustment: 4, /* number of pixels to subtract from right edge of the fake input  */
            leftEdgeAdjustment: 1,  /* number of pixels to add from left edge of the fake input */
            caretAdjustment: 1,     /* number of pixels to subtract from the x coordinates of the fake caret */
            fireInput: true,        /* wether the "input" event should be fired */
            fireChange: true,       /* wether the "change" event should be fired */
            overrideSelectors: true /* wether to override the selector API to impersonate input tag in a selector */
        };
    }

    $.extend(FakeInput.prototype, {
        markerClassName: 'fab-fakeinput',
        propertyName: 'fab-fakeinput',

        /**
         * Public method to set the plugin global defaults.
         *
         * @param {Object|String} options - (Optional) the option(s) to get or set
         * @returns {FakeInput}
         */
        setDefaults: function (options) {
            $.extend(this.defaults, options || {});
            return this;
        },

        //////////////////////////////////////////////////////////////////////////////////
        //                                                                              //
        //                    TEXT MANIPULATION AND NAVIGATION                          //
        //                                                                              //
        //////////////////////////////////////////////////////////////////////////////////


        /**
         * Public jQuery plugin method to attach the plugin instance to an existing element.
         *
         * @param target - the fake jquery input
         * @param {Object|String} options - (Optional) the option(s) to get or set
         * @private
         */
        _attachPlugin: function (target, options) {
            var inst,
                $target = $(target),
                currentValue = currentValue = $target.prop("value") || $target.attr("value") || ""
            ;

            if ($target.hasClass(this.markerClassName)) {
                return;
            }

            inst = {
                options: $.extend({}, this.defaults),
            };

            if ($target.is("input[type='text']")) { // if an input text is specified, replace it

                // here we want to scavenge all attributes/properties assigned inline on the input
                // as input is a children-less element, using outerHTML fits the need.
                // Note: this is does not preserve attached event handlers! there is no way to find them out in pure javascript!
                // Also jquery remove jquery event handlers + data when replacing.
                $target = $(target.outerHTML.replace("input", "span")).replaceAll($target); // replaceAll returns the new object, whereas replaceWith the old one!
                // target.removeAttr("type"); // remove type='text'
            }

            $target.data(this.propertyName, inst)
                .attr("tabindex", "1") // make it focusable/tabbable
                .html("<span class='" + this.markerClassName + "-textnode'>" + currentValue + "</span>"); // fake text node

            $target._hasChanged = false; // we will use this to trigger change event if needed

            this._setCaretPlugin();
            this._impersonateInputStyle($target);
            this._impersonateInputAttributes($target);
            this._initEvents($target);

            // check the overrideSelectors in the defaults options only, it's a non-sense to use this option per-widget
            if (this.defaults.overrideSelectors === true) {
                this._impersonateInputSelectors($target);
            }

            this._optionPlugin($target, options);
        },


        /**
         * Public jQuery plugin method to get/set one or multiple plugin options following jQuery plugin guidelines.
         * @param target - the fake jquery input
         * @param {Object|String} options - (Optional) the option(s) to get or set
         * @param {*} value - (Optional) the value to set for the option
         * @private
         */
        _optionPlugin: function (target, options, value) {
            /* start of boilerplate code common to most jquery plugins */
            $target = $(target);
            var inst = $target.data(this.propertyName); // retrieve current instance settings

            if (!options || (typeof options == 'string' && value == null)) {
                // Get option
                var name = options;
                options = (inst || {}).options;
                return (options && name ? options[name] : options);
            }

            if (!$target.hasClass(this.markerClassName)) { // if plugin not yet initialized
                return;
            }

            options = options || {};
            if (typeof options == 'string') { // handle single named option
                var name = options;
                options = {};
                options[name] = value;
            }
            $.extend(inst.options, options); // update with new options
            /* end of boilerplate code */
        },

        /**
         * Set the char to use for the caret.
         * We would almost want to have the vertical bar '|' but we could use fancier unicode chars if we wanted
         * (though the width of this char should fit inside 2 adjacent chars as its width is not taken into account
         * in the future calculations).
         *
         * @param {String} caretChar - (Optional) the char to use (vertical bar by default)
         * @private
         */
        _setCaretPlugin: function (caretChar) {
            caretChar = caretChar || '|';

            if (!$fakeCaret.length) {
                $fakeCaret = $("<span id='" + this.markerClassName + "-fakecaret' class='"+ this.markerClassName +"-fakecaret'></span>");
                StyleHelper.makeInert($fakeCaret[0]);
                $("body").append($fakeCaret);
            }
            $fakeCaret.text(caretChar);
        },


        /**
         * Impersonate the styles of a real input text in the context of the current page.
         *
         * @param {jQuery} $target - the fake jquery input
         * @private
         */
        _impersonateInputStyle: function ($target) {
            var $realInput = $('#' + this.markerClassName + '-impersonated-input'),
                stylesToRestore = {},
                computedInputStyle = {},
                realInputStyle = null
            ;

            if (!$realInput.length) {
                // insert a real input in the page so we can retrieve all its calculated styles
                $realInput = $("<input type='text' id='" + this.markerClassName + "-impersonated-input'>");
                stylesToRestore = StyleHelper.makeInert($realInput[0]);
                $("body").append($realInput);

                // Save a new CSS class rule based on the calculated style.
                // This is convenient instead of inline styling because:
                //  - we can simply toggle the class on future fake inputs
                //  - it keeps the code DRY as the styles are not repeated inline
                //  - it doesn't bloat the DOM inspector with very long lines of inline styles
                realInputStyle = StyleHelper.addCSSRule('.' + this.markerClassName + '{' +
                    StyleHelper.getComputedStyleCssText($realInput[0]) +
                '}');

                for (var prop in stylesToRestore) { // override styles
                    if (stylesToRestore.hasOwnProperty(prop)) {
                        realInputStyle[prop] = stylesToRestore[prop];
                    }
                }
            }

            $target.addClass(this.markerClassName);
        },


        /**
         * Impersonate the relevant attributes specific to a real text input.
         *
         * @param {jQuery} $target - the fake jquery input
         * @private
         */
        _impersonateInputAttributes: function ($target) {
            var target = $target[0],
                $fakeTextNode = $target.children()
            ;

            // define the getter & setter for the value property
            Object.defineProperty(target, "value", {
                get: function () {
                    return $fakeTextNode.text();
                },
                set: function (val) {
                    $fakeTextNode.text(val);
                }
            });

            // set selection attributes at the end
            target.selectionStart = target.selectionEnd = $fakeTextNode.text().length;

            target.focus = function () {
                // don't use jquery trigger as it will call .focus() => infinite loop!
                var focusEvent = new FocusEvent("focus");
                target.dispatchEvent(focusEvent);
            };

            target.blur = function () {
                // don't use jquery trigger as it will call .blur() => infinite loop!
                var blurEvent = new FocusEvent("blur"); // Blur hérite de FocusEvent interface
                target.dispatchEvent(blurEvent);
            };
        },


        /**
         * Retrieves the the new caret coordinates based on current selectionStart/selectionEnd of the fake input.
         *
         * @param {jQuery} $target - the fake jquery input
         * @returns {top: number, left: number} - the top-left coordinate of the caret
         * @private
         */
        _getAbsoluteCaretCoordinates: function ($target) {
            var target = $target[0],
                $fakeTextNode = $target.children(),
                caretAdjustment = this._optionPlugin($target, "caretAdjustment"),
                realTextNode = $fakeTextNode[0].childNodes[0],
                range = document.createRange(),
                top,
                left
            ;

            if (realTextNode === undefined) {
                realTextNode = document.createTextNode("");
                $fakeTextNode.append(realTextNode);
            }

            // create range from first char to selectionEnd
            range.setStart(realTextNode, 0);
            range.setEnd(realTextNode, target.selectionEnd);

            top = target.getBoundingClientRect().top;
            left = range.getBoundingClientRect().right - caretAdjustment;

            return {
                top: top,
                left: left
            };
        },


        /**
         * Retrieves the new caret coordinates based on current selectionStart/selectionEnd,
         * bounded by the fake input box coordinates and edge adjustments options.
         *
         * @param $target - the fake jquery input
         * @returns {{top: (Number|*), left: (number|*)}} - the bounded caret coordinates
         * @private
         */
        _getBoundedCaretCoordinates: function ($target) {
            var target = $target[0],
                rightEdgeAdjustment = this._optionPlugin($target, "rightEdgeAdjustment"),
                $fakeTextNode = $target.children(),
                caretCoords = this._getAbsoluteCaretCoordinates($target),
                targetRect,
                adjustedRangeRectLeft,
                adjustedTargetRectRight,
                constrainedLeft
            ;

            targetRect = target.getBoundingClientRect();

            // rectangle objects are readonly, so we have to introduce new variables to adjust the values
            adjustedRangeRectLeft = caretCoords.left - (parseInt($fakeTextNode.css("left"), 0) || 0);
            adjustedTargetRectRight = targetRect.right - rightEdgeAdjustment;

            constrainedLeft = caretCoords.left;

            // prevent going outside fake input borders
            if (caretCoords.left > adjustedTargetRectRight) {
                constrainedLeft = adjustedTargetRectRight;
            }
            if (adjustedRangeRectLeft < targetRect.left) {
                constrainedLeft = targetRect.left;
            }

            return {
                top: caretCoords.top,
                left: constrainedLeft
            };
        },


        /**
         * Retrieves the width in pixels of the param text if it was to be inserted in the $target node
         *
         * @param {jQuery} $target - a jQuery node (typically the fake input)
         * @param {String} text - the text whose width we want to calculate
         * @returns {Number} the calculated width
         * @private
         */
        _getTextContentWidth: function ($target, text) {
            var $fakeTextNode = $target.children(),
                textIdx = $fakeTextNode.text().indexOf(text),
                range
            ;

            if (textIdx === -1) {
                return 0;
            }

            range = document.createRange();
            range.setStart($fakeTextNode[0].childNodes[0], textIdx);
            range.setEnd($fakeTextNode[0].childNodes[0], textIdx + text.length);

            return range.getBoundingClientRect().width;
        },


        /**
         * Returns the width of the chars located numChars before or after the current caret position.
         *
         * @param {jQuery} $target - the fake jquery input
         * @param {Integer} numChars - if positive, the number of chars after the caret,
         *                             if negative, the number of chars before the caret
         * @returns {Number} the queried width
         * @private
         */
        _getCharsWidthRelativeToCaret: function ($target, numChars) {
            var target = $target[0],
                selStart = target.selectionStart,
                charsRelativeToCaret = target.value.substring(selStart, selStart + numChars)
            ;

            return this._getTextContentWidth($target, charsRelativeToCaret);
        },


        /**
         * Shift the inner fake text node to the left after we:
         *  - added a new char at the end of the fake input
         *  - pressed the right arrow key at the far right end of the fake input
         *
         * @param {jQuery} $target - the fake jquery input
         * @param {Number} value - the number of pixels to shift
         * @private
         */
        _shiftTextNodeLeft: function ($target, value) {
            var $fakeTextNode = $target.children();

            $fakeTextNode.css("left", "-=" + value);
        },



        /**
         * Shift the inner fake text node right after we:
         *   - deleted a portion of the text
         *   - pressed the left arrow key at the far left end of the fake input
         *
         * @param {jQuery] $target - the fake jquery input
         * @param {Number} value - the number of pixels to shift
         * @private
         */
        _shiftTextNodeRight: function ($target, value) {
            var $fakeTextNode = $target.children(),
                currentShiftLeft = parseInt($fakeTextNode.css("left"), 0) || 0
            ;

            value = Math.min(value, Math.abs(currentShiftLeft)); // right shift must never be greater than 0
            $fakeTextNode.css("left", "+=" + value);
        },




        /**
         * Show/Update the caret coordinates based on the current fake input's selectionStart and selectionEnd
         *
         * @param {jQuery} $target - the fake jquery input
         * @private
         */
        _showCaret: function ($target) {
            var coords = this._getBoundedCaretCoordinates($target);

            $fakeCaret.css({
                // reminder: jquery converts a number to string and append "px" when it detects a number
                top: coords.top,
                left: coords.left,
                height: $target.outerHeight()
            });

            StyleHelper.unmakeInert($fakeCaret[0]);
        },


        /**
         * Handle the deletion of one or multiple chars (via selection) after we:
         *  - pressed the backspace key
         *  - pressed the suppr key
         *
         * @param {jQuery} $target - the fake jquery input
         * @private
         */
        _handleDeleteKey: function ($target) {
            var target = $target[0],
                selStart = target.selectionStart,
                selEnd = selStart,
                value = target.value,
                selection = window.getSelection(),
                deletedTextWidth
            ;

            if (selection.anchorNode === selection.focusNode &&
                selection.isCollapsed === false) { // only our fake input has selection and is visible
                deletedTextWidth = this._getTextContentWidth($target, selection.toString());

                selection.deleteFromDocument();

                target.selectionStart = target.selectionEnd = selection.anchorOffset;
            } else {
                deletedTextWidth = this._getCharsWidthRelativeToCaret($target, -1);

                selStart = Math.max(selStart - 1, 0);
                target.value = value.slice(0, selStart) + value.slice(selEnd);
                target.selectionStart = target.selectionEnd = selStart;
            }

            this._shiftTextNodeRight($target, deletedTextWidth);

            if (target.value !== value && this._optionPlugin(target, "fireInput") === true) {
                this._fireInputEvent($target);
            }
        },


        /**
         * Fire native input event
         * @param $target - the fake jquery input
         * @private
         */
        _fireInputEvent: function ($target) {
            // Note: la spec defines a InputEvent interface but the constructor is not yet
            // implemented in Chrome (Chromium status: in development) so instead we use
            // a generic Event object.
            var inputEvent = new Event("input", {
                bubbles: true,
                cancelable: false
            });
            $target[0].dispatchEvent(inputEvent);
        },


        /**
         * Handle the pressing of the left arrow key.
         * It needs to:
         *   - adjust the fake input new selectionStart/selectionEnd
         *   - shift the fake text node right when we are at the far left edge
         *
         * @param {jQuery} $target - the fake jquery input
         * @private
         */
        _handleLeftArrowKey: function ($target) {
            var target = $target[0];

            target.selectionStart = target.selectionEnd = Math.max(target.selectionStart - 1, 0);

            this._adjustTextNodePosition($target);
        },


        /**
         * Handle the pressing of the right arrow key.
         * It needs to:
         *   - adjust the fake input new selectionStart/selectionEnd
         *   - shift the fake text node left when we are at the far right edge
         *
         * @param {jQuery} $target - the fake jquery input
         * @private
         */
        _handleRightArrowKey: function ($target) {
            var target = $target[0];

            target.selectionStart = target.selectionEnd = Math.min(target.selectionEnd + 1, target.value.length);

            this._adjustTextNodePosition($target);
        },

        /**
         * Adjust the text position by shifting either left or right when the caret is located
         * outside its boundaries.
         *
         * @param {jQuery} $target - the fake jquery input
         * @private
         */
        _adjustTextNodePosition: function ($target) {
            var absCaretCoordsLeft = this._getAbsoluteCaretCoordinates($target).left,
                targetRect = $target[0].getBoundingClientRect(),
                rightEdgeAdjustment = this._optionPlugin($target, "rightEdgeAdjustment"),
                leftEdgeAdjustment = this._optionPlugin($target, "leftEdgeAdjustment"),
                targetRightEdgeAdjusted = targetRect.right - rightEdgeAdjustment,
                targetLeftEdgeAdjusted = targetRect.left + leftEdgeAdjustment,
                shift
            ;
            // Example right shift algo:
            //
            //                    shift
            //                    <--->
            //   +----------------+
            //   |AAAAAAAAAAAAAAAA|   |
            //   +----------------+   ^
            //                    ^   absolute caret position
            //                    |
            //                   right edge
            //             (minus rightEdgeAdjustment)

            if (absCaretCoordsLeft > targetRightEdgeAdjusted) {
                shift = absCaretCoordsLeft - targetRightEdgeAdjusted;
                this._shiftTextNodeLeft($target, shift);
            } else if (absCaretCoordsLeft < targetLeftEdgeAdjusted) {
                shift = targetLeftEdgeAdjusted - absCaretCoordsLeft;
                this._shiftTextNodeRight($target, shift);
            }
        },

        /**
         * Handle the insertion of a new char after pressing an alphanumeric key.
         * It needs to:
         *   - handle the potential shift when we inserted at the far right edge
         *   - replace the current selection with the pressed key char if such selection exists
         *   - adjust the fake input new selectionStart/selectionEnd
         *
         * @param {jQuery} $target - the fake jquery input
         * @param {Char} newChar - the char to insert
         * @private
         */
        _handleCharKey: function ($target, newChar) {
            var selection = window.getSelection(),
                target = $target[0],
                value
            ;

            if (selection.anchorNode === selection.focusNode &&
                selection.isCollapsed === false) { // only our fake input has selection and is visible
                selection.deleteFromDocument();

                target.selectionStart = target.selectionEnd = selection.anchorOffset;
            }

            value = target.value; // current value (after deleted selection if condition was true above)

            target.value = value.slice(0, target.selectionStart) + newChar + value.slice(target.selectionEnd);
            target.selectionStart = target.selectionEnd = target.selectionStart + 1;

            // Note, when we are in this situation:
            //                caret at right edge
            //                 v
            //  +--------------|+
            //  |AAAAAAAAAAAAAA||AAAAAAAAAAAAAAAAAAA... => a lot of overflow
            //  +--------------|+
            //  < - - - - - - - >
            //      width       ^
            //                  end of input
            //
            // If we type a char key, the behaviour is different in Chrome & Firefox:
            //   -> on Chrome, the caret is reset to the middle of the input (width / 2) and the text shifted accordingly
            //   -> on Firefox, nothing special happen, the text is simply shifted to show the new char, as usual
            // To simplify, we use Firefox behaviour. Chrome behaviour was implemented in a different, more complicated,
            // algorithm where the grunt work was done in the shift left/right methods.
            // See _shiftTextNodeLeft in old commit: 5b0d1e7884a6cac11be92e4b6a74edd917991f53
            //
            this._adjustTextNodePosition($target);

            if (target.value !== value && this._optionPlugin(target, "fireInput") === true) {
                this._fireInputEvent($target);
            }
        },


        /**
         * Handle focus event by adjusting the text node position according to current selectionStart/End values.
         * @param $target - the fake input jquery node
         * @private
         */
        _handleFocus: function ($target) {
            this._adjustTextNodePosition($target);
        },

        /**
         * Impersonate a mouse or touch event by stopping its propagation immediately and dispatching
         * a newly created matching event on the target.
         * @param target - the fake input DOM node
         * @param {MouseEvent|TouchEvent} originalEvent to impersonate
         * @private
         */
        _impersonateTouchMouseEvent: function (target, originalEvent) {
            var event;

            // create new event from current event data
            if (originalEvent instanceof MouseEvent) {
                event = new MouseEvent(originalEvent.type, originalEvent);
            } else if (originalEvent instanceof TouchEvent) {
                event = new TouchEvent(originalEvent.type, originalEvent);
            }

            originalEvent.stopImmediatePropagation();

            // Note: when the built-in event was created, all properties were inherited except "target".
            // This seems to be for security reasons. "target" is readonly and cannot be modified or set.
            // The "target" attribute is only filled automatically from the node we call dispatchEvent on.
            target.dispatchEvent(event);
        },


        /**
         * Init the events handlers for the fake input (should be called once at plugin init).
         *
         * @param {jQuery} $target - the fake jquery input
         * @private
         */
        _initEvents: function ($target) {
            var target = $target[0],
                fakeTextNode = $target.children()[0]
            ;

            // we don't use jquery events to have total controls in case it gets tricky...

            // We want to hide the fact we have a fake inner text node on mouse & touch events
            // (for now we don't care about other events).
            // As the inner text node takes up the whole fake input area, it will be the one
            // actually receiving the actual event. As such when it bubbles, its "target" attribute
            // will indicate the origin comes from the text node instead of the fake input, breaking the client
            // code that assumes that e.target == fake input (real inputs don't have children).
            // As the "target" attribute is readonly and cannot ever be set/changed, the trick is to
            // listen for the event directly on the fake inner text node, stop its propagation
            // immediately, and trigger a newly created matching event on the fake input.
            fakeTextNode.addEventListener("mousedown", plugin._impersonateTouchMouseEvent.bind(fakeTextNode, target));
            fakeTextNode.addEventListener("click", plugin._impersonateTouchMouseEvent.bind(fakeTextNode, target));
            fakeTextNode.addEventListener("mouseup", plugin._impersonateTouchMouseEvent.bind(fakeTextNode, target));
            fakeTextNode.addEventListener("dblclik", plugin._impersonateTouchMouseEvent.bind(fakeTextNode, target));
            fakeTextNode.addEventListener("mousemove", plugin._impersonateTouchMouseEvent.bind(fakeTextNode, target));
            fakeTextNode.addEventListener("mouseover", plugin._impersonateTouchMouseEvent.bind(fakeTextNode, target));
            fakeTextNode.addEventListener("mouseout", plugin._impersonateTouchMouseEvent.bind(fakeTextNode, target));
            fakeTextNode.addEventListener("mousewheel", plugin._impersonateTouchMouseEvent.bind(fakeTextNode, target));

            fakeTextNode.addEventListener("touchstart", plugin._impersonateTouchMouseEvent.bind(fakeTextNode, target));
            fakeTextNode.addEventListener("touchend", plugin._impersonateTouchMouseEvent.bind(fakeTextNode, target));
            fakeTextNode.addEventListener("touchcancel", plugin._impersonateTouchMouseEvent.bind(fakeTextNode, target));
            fakeTextNode.addEventListener("touchmove", plugin._impersonateTouchMouseEvent.bind(fakeTextNode, target));


            // mousedown event on fake input will only occur from programmatically created event in the
            // fake inner text node (see above)
            // This sets the caret in-between chars depending on when the user pressed/touched the fake input.
            target.addEventListener("mousedown", function (e) {
                var range, offset;

                if (document.caretPositionFromPoint) { // current standard, Firefox only
                    range = document.caretPositionFromPoint(e.clientX, e.clientY);
                    offset = range.offset;

                } else if (document.caretRangeFromPoint) { // old standard, others
                    range = document.caretRangeFromPoint(e.clientX, e.clientY);
                    offset = range.startOffset;
                }

                this.selectionStart = this.selectionEnd = offset;

                plugin._showCaret($target);
                console.log("clicked");
            });


            // focus & blur events are fired automatically by the browser as the fake inputs were made focusable
            // from adding tabindex

            target.addEventListener("focus", function () {
                plugin._handleFocus($target);
                plugin._showCaret($target);
                console.log("focused");
            });

            target.addEventListener("blur", function () {
                var changeEvent;

                // as there is only one caret instance for all fake inputs, we could think this handler
                // should be attached on the document via bubbling/delegation instead of attaching the handler
                // for every elements.
                // But by definition, the blur/focus events should not bubble. We could make it bubble via jquery
                // using delegation (see doc) but this could introduce hard to find bugs from the client script,
                // so we stick to attaching the handler for everyone.
                //
                // Note: Firefox & Chrome handle blur differently:
                //    - Chrome: on blur, the text position is reset to the start (far left)
                //    - Firefox: the text is not repositioned and left as is.
                // Again, we chose the simplest: do not reposition, like Firefox.
                StyleHelper.makeInert($fakeCaret[0]);

                if ($target._hasChanged === true && plugin._optionPlugin($target, "fireChange") === true) {
                    changeEvent = new Event("change", {
                        bubbles: true,
                        cancelable: false
                    });
                    target.dispatchEvent(changeEvent);

                    $target._hasChanged = false;
                }

                console.log("blurred");
            });

            // Handling key events properly cross-browser is a pain in the ass.
            // For now we provide basic cross-browser support by taking into account that Chrome
            // does not fire keypress event when key is not printable (notable exceptions are Backspace or Enter)
            // but Firefox does.
            target.addEventListener("keypress", function (e) {
                if (e.which !== 13 && e.charCode !== 0) { // not "Enter" and printable key (simplified check for now...)
                    plugin._handleCharKey($target, e.key);
                    plugin._showCaret($target);
                }
            });

            target.addEventListener("keydown", function (e) {
                var selStart = this.selectionStart;

                if (e.which === 8) { // backspace
                    plugin._handleDeleteKey($target);
                    plugin._showCaret($target);

                    e.preventDefault(); // prevent default browser action of going back in history (or at least proposing)
                } else if (e.which === 46) { // del key <=> right arrow + backspace
                    plugin._handleRightArrowKey($target);
                    // actually test if we were at already at the end => no delete then
                    if (this.selectionStart !== selStart) {
                        plugin._handleDeleteKey($target);
                    }
                    plugin._showCaret($target);
                } else if (e.which === 37) { // left arrow
                    plugin._handleLeftArrowKey($target);
                    plugin._showCaret($target);
                } else if (e.which == 39) { // right arrow
                    plugin._handleRightArrowKey($target);
                    plugin._showCaret($target);
                }
            });

            // triggered manually when fake input value is changed
            target.addEventListener("input", function (e) {
                $target._hasChanged = true; // mark as changed to enable change event triggering
                console.log("input");
            });
        },


        //////////////////////////////////////////////////////////////////////////////////
        //                                                                              //
        //                    NATIVE SELECTORS INTEGRATION API                          //
        //                                                                              //
        //////////////////////////////////////////////////////////////////////////////////

        /**
         * Performs a selector-based query against a native selector API function, gathering fake inputs elements
         * if an input tag selector is provided.
         * @param {String} fnName - name of a native selector API function
         * @param {String} selector - the selector to query
         * @returns {*} the result of the native call
         * @private
         */
        _query: function (fnName, selector) {
            var match,
                selector = selector,

                // instead of doing any kind of parsing on the selector to detect if the input tag is present
                // we execute a dummy replace with the plugin class name and catch the error thrown
                // if this switch formed a invalid selector (for instance if the word "plugin" is not a tag name
                // in the selector but part of something else like .input, #input, .myinputName, etc.)
                modifiedSelector = selector.replace("input", "." + plugin.markerClassName)
            ;

            nativeAPI[fnName]._nonNativeExpando = true; // mark as initialized

            // if (/:invalid|:valid|:required/g.test(selector))

            try {
                if (modifiedSelector !== selector) {
                    match = nativeAPI[fnName].call(this, modifiedSelector + ", " + selector);
                    if (match !== null) {
                        match = match.length ? match : [match]; // array-like if jquery or array if native
                        for(var i = 0; i < match.length; i++) {
                            if (this._optionPlugin($(match[i]), "overrideSelector") === true) {

                            }
                        }
                        return match;
                    }
                }
            } catch(e) {};

            return nativeAPI[fnName].call(this, selector);
        },


        /**
         * Overrides the selector API to match the fake inputs when the input tag is present in a selector.
         * @private
         */
        _impersonateInputSelectors: function ($target) {
            var target = $target[0],
                jqFnNames = ["is", "find", "filter", "not"]
            ;

            if (document.querySelector._nonNativeExpando === true) { // already initialized
                return;
            }

            // Oddly, browsers don't allow overriding native document properties by direct affectation
            // (though ok in the debug console), but it works if redefine its properties directly
            // (any documentation on the logic behind this behaviour ? haven't found yet)
            Object.defineProperties(document, {
                querySelector: {
                    get: function () {
                        return plugin._query.bind(document, "querySelector");
                    }
                },
                querySelectorAll: {
                    get: function () {
                        return plugin._query.bind(document, "querySelectorAll");
                    }
                }
            });

            Object.defineProperty(document.documentElement, "matches", {
                // this one is a little trickier as it is typically called on the element like:
                //      elem.matches(selector);
                //  But this is actually equivalent to:
                //      document.documentElement.matches.call(elm, selector);
                // So we also need to capture the context of the current call.
                get: function () {
                    return function (selector) {
                        return plugin._query.call(this, "matches", selector);
                    };
                }
            });

            // We need to override jquery selector methods too. Even though they make use of
            // native API under the hood, the Sizzle engine actually saves references to the
            // native functions before our override code even run!
            jqFnNames.forEach(function (name) {
                var capitalized = name[0].toUpperCase() + name.substring(1);

                // Those jquery selector functions are also called from inside jQuery code,
                // meaning the context changes between $.fn and document.
                // So we also need to capture the context of the current call.
                $.fn[name] = function (selector) {
                    return plugin._query.call(this, "jq" + capitalized, selector);
                };
            });
        },



        //////////////////////////////////////////////////////////////////////////////////
        //                                                                              //
        //                           CONSTRAINT VALIDATION API                          //
        //                                                                              //
        //////////////////////////////////////////////////////////////////////////////////





    });

    var plugin = $.fakeinput = new FakeInput();


    $.fn.fakeinput = function (options) {
        var otherArgs = Array.prototype.slice.call(arguments, 1);
        return this.each(function () {
            if (typeof options == 'string') {
                if (!plugin['_' + options + 'Plugin']) {
                    throw 'Unkown method: ' + options;
                }
                plugin['_' + options + 'Plugin'].apply(plugin, [this].concat(otherArgs));
            } else {
                plugin._attachPlugin(this, options || {});
            }
        });
    };

    $.fn.fakeinput.defaults = plugin.defaults;
}));