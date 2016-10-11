/*
 * Impersonate a input type='text' only.
 *
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
 * - navigating to the start or end of the input via Home and End keys
 * - copy-pasting via Ctrl+C Ctrl+V (context menu is only available on real inputs)
 * - outline styling on focus
 * - selectionchange event (not yet supported by browsers)
 * - impersonation of CSS styles related to validation pseudo-classes (:invalid, :valid, :required...)
 * - impersonation of DOM Level 2 methods of element retreival (getElementById, getElementsByTagName, ....)
 * - inheritance of the fake input color style by the caret (at least chrome does this)
 */

(function (factory) {
    if (typeof define === "function" && define.amd) {
        // AMD. Register as an anonymous module.
        define([
            "jquery",
            "./stylehelper.js"
        ], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node/CommonJS
        module.exports = factory(require("jquery"), require("./stylehelper.js"));
    } else {
        // Browser globals
        factory(jQuery, StyleHelper);
    }
}(function ($, StyleHelper) {

    var getters = []; // list of getter methods (none for the moment)

    var $fakeCaret = $(); // only one caret instance for everyone

    var $realInputProxy = $(); // only one input proxy instance for everyone

    var validationAPI = {
        htmlAttrs:  ["type", "pattern", "maxlength", "min", "max"],
        htmlProps: ["required", "novalidate", "formnovalidate"],
        oAttrs: ["validationMessage", "willValidate", "validity"],
        fns: ["checkValidity", "setCustomValidity"]
    };

    var selectorAPI = { // save original selector APIs
        native: {
            querySelector: document.querySelector,
            querySelectorAll: document.querySelectorAll,
            matches: document.documentElement.matches
        },

        // jquery selector functions
        // TODO: provide an extension API to allow the user to define its own
        // overrides in order to handle any kind of third-party selector APIs
        jquery: {
            jqFilter: $.fn.filter,
            jqFind: $.fn.find,
            jqNot: $.fn.not,
            jqIs: $.fn.is
        }
    };

    // we keep tracks of event listeners added via direct calls to addEventListener()
    // Note: current status is we only add one listener per event, but we still use arrays in case this changes later.
    var fakeTextNodeEventListeners = {
        mousedown: [],
        click: [],
        mouseup: [],
        dblclick: [],
        mousemove: [],
        mouseover: [],
        mouseout: [],
        mousewheel: [],
        touchstart: [],
        touchend: [],
        touchcancel: []
    };

    var fakeInputEventListeners = {
        mousedown: [],
        blur: [],
        focus: [],
        keypress: [],
        keydown: []
    };



    function FakeInput() {
        this.defaults = {
            rightEdgeAdjustment: 4,    /* number of pixels to subtract from right edge of the fake input  */
            leftEdgeAdjustment: 1,     /* number of pixels to add from left edge of the fake input */
            caretAdjustment: 1,        /* number of pixels to subtract from the x coordinates of the fake caret */
            fireInput: true,           /* wether the "input" event should be fired */
            fireChange: true,          /* wether the "change" event should be fired */
            integrateSelectors: true,  /* wether to override the selector API to impersonate input tag in a selector */
            integrateValidations: true /* wether to override the validation API  */
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
         * WARNING: this uses .replaceChild() internally so anything attached to the replaced element
         * will be lost for the duration of the plugin life (restored on destroy).
         *
         * @param target - the fake jquery input
         * @param {Object|String} options - (Optional) the option(s) to get or set
         * @private
         */
        _attachPlugin: function (target, options) {
            var inst,
                $target = $(target),
                currentValue = $target.prop("value") || $target.attr("value") || ""
            ;

            if ($target.hasClass(this.markerClassName)) { // already attached
                return;
            }

            inst = {
                options: $.extend({}, this.defaults),
                originalElement: target
            };

            // We turn the target into our fake input, inheriting all attributes/properties currently assigned inline on
            // the element(whatever the type of the element).
            // Note: this is does not preserve attached event handlers! there is no way to find them in pure javascript!
            // Also jquery remove jquery event handlers + data when replacing.
            $target = $(target.outerHTML.replace(target.tagName.toLowerCase(), "span")).replaceAll($target); // replaceAll returns the new object, whereas replaceWith the old one!

            $target.empty(); // remove all children in case the element had children

            target = $target[0];

            $target.data(this.propertyName, inst);

            this._impersonateInputStyle($target); // do this before adding child textnode!

            $target.attr("tabindex", "1") // make it focusable/tabbable
                .html("<span class='" + this.markerClassName + "-textnode'>" + currentValue + "</span>"); // fake text node

            $target._hasChanged = false; // we will use this to trigger change event if needed

            this._setCaretPlugin();

            this._impersonateInputAttributes($target);
            this._initEvents($target);

            this._optionPlugin(target, options);
        },


        /**
         * Public jQuery plugin method to get/set one or multiple plugin options following jQuery plugin guidelines.
         * @param target - the fake input node
         * @param {Object|String} options - (Optional) the option(s) to get or set
         * @param {*} value - (Optional) the value to set for the option
         * @private
         */
        _optionPlugin: function (target, options, value) {
            /* start of boilerplate code common to most jquery plugins */
            var $target = $(target),
                inst = $target.data(this.propertyName) // retrieve current instance settings
            ;

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

            if (inst.options.integrateSelectors === true) {
                $target.attr("type", "text"); // force type text
                this._impersonateInputSelectors($target);
            } else {
                $target.removeAttr("type");
                this._stopSelectorsImpersonation($target);
            }
            if (inst.options.integrateValidations === true) {
                this._impersonateValidations($target);

                // setup the validity classes right away
                this._toggleValidityClasses($target, target.validity.valid);
            } else {
                this._stopValidationsImpersonation($target);
            }
        },

        /**
         * Set the char to use for the caret.
         * We would almost always want to have the vertical bar '|' but we could use fancier unicode chars if we wanted
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
         * Impersonate the styles of a real input text in the context of its parent.
         *
         * @param {jQuery} $target - the fake jquery input
         * @private
         */
        _impersonateInputStyle: function ($target) {
            var stylesToRestore,
                target = $target[0],
                $doppleganger,
                doppleganger,
                dopplegangerStyle,
                markerClassDoppleganger = this.markerClassName + "-doppleganger",
                // do not user selector API as we already filter it from the result set!
                $previousDoppleGanger = $(document.getElementsByClassName(markerClassDoppleganger)),
                // this counter allows us to create a unique css rule each time
                styleIncr = $previousDoppleGanger.length ? $previousDoppleGanger.data("incr") : 0
            ;

            if ($previousDoppleGanger.parent()[0] === $target.parent()[0]) { // same style already defined
                $target.addClass(this.markerClassName + ' ' + this.markerClassName + '-' + styleIncr);
                return;
            }

            styleIncr++;

            $previousDoppleGanger.remove(); // we will create a new one so this one won't be needed anymore

            // create a real input doppleganger from the target
            // (Note: this is redundant if the target was already an input)
            $doppleganger = $(target.outerHTML.replace(target.tagName.toLowerCase(), "input"))
                .removeAttr("id")
                .addClass(markerClassDoppleganger);

            doppleganger = $doppleganger[0];

            $doppleganger.data("incr", styleIncr); // save current incrementation
            $realInputProxy = $doppleganger; // whenever a real input proxy will be needed for validation, we can use this one

            // insert a real input in the page so we can retrieve all its calculated styles
            stylesToRestore = StyleHelper.makeInert(doppleganger);
            $target.after($doppleganger);

            // Save a new CSS class rule based on the calculated style.
            // This is convenient instead of inline styling because:
            //  - we can simply toggle the class on future fake inputs
            //  - it keeps the code DRY as the styles are not repeated inline
            //  - it doesn't bloat the DOM inspector with very long lines of inline styles
            dopplegangerStyle = StyleHelper.addCSSRule('.' + this.markerClassName + '-' + styleIncr,
                StyleHelper.getComputedStyleCssText(doppleganger));

            for (var prop in stylesToRestore) { // override styles
                if (stylesToRestore.hasOwnProperty(prop)) {
                    dopplegangerStyle[prop] = stylesToRestore[prop];
                }
            }

            $target.addClass(this.markerClassName + ' ' + this.markerClassName + '-' + styleIncr);
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
                    var currentVal = $fakeTextNode.text();
                    $fakeTextNode.text(val);
                    if (val != currentVal) {
                        plugin._handleValueChanged($target);
                    }
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

            if (value.length >= ($target.attr("maxlength") || Infinity)) {
                return;
            }

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
        },


        /**
         * When the fake input value changes, we can perform some synchronous operations like triggering the "input" event
         * or marking/unmarking the input as valid or invalid
         * @param $target - the fake jquery input
         * @private
         */
        _handleValueChanged: function ($target) {
            var target = $target[0],
                isValid
            ;

            if (this._optionPlugin(target, "fireInput") === true) {
                this._fireInputEvent($target);
                $target._hasChanged = true; // mark as changed to enable change event triggering
            }
            if (this._optionPlugin(target, "integrateValidations") === true) {
                this._toggleValidityClasses($target, target.checkValidity());
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
            // Because of this we have to keep track of the event handlers to be able to remove them later with removeEventListener().
            // (We want to do this as to avoid any potential memory leaks)

            // We want to hide the fact we have a fake inner text node on mouse & touch events
            // (for now we don't care about other events).
            // As the inner text node takes up the whole fake input area, it will be the one
            // actually receiving the actual event. As such when it bubbles, its "target" attribute
            // will indicate the origin comes from the text node instead of the fake input, breaking the client
            // code that assumes that e.target == fake input (real inputs don't have children).
            // As the "target" attribute is readonly and cannot ever be set/changed, the trick is to
            // listen for the event directly on the fake inner text node, stop its propagation
            // immediately, and trigger a newly created matching event on the fake input.

            for (var eventName in fakeTextNodeEventListeners) {
                fakeTextNodeEventListeners[eventName].unshift(plugin._impersonateTouchMouseEvent.bind(fakeTextNode, target));
                fakeTextNode.addEventListener(eventName, fakeTextNodeEventListeners[eventName][0]);
            };

            // mousedown event on fake input will only occur from programmatically created event in the
            // fake inner text node (see above)
            // This sets the caret in-between chars depending on when the user pressed/touched the fake input.
            fakeInputEventListeners.mousedown.unshift(function (e) {
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
            target.addEventListener("mousedown", fakeInputEventListeners.mousedown[0]);


            // focus & blur events are fired automatically by the browser as the fake inputs were made focusable
            // from adding tabindex

            fakeInputEventListeners.focus.unshift(function () {
                plugin._handleFocus($target);
                plugin._showCaret($target);
                console.log("focused");
            });
            target.addEventListener("focus", fakeInputEventListeners.focus[0]);

            fakeInputEventListeners.blur.unshift(function () {
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
            target.addEventListener("blur", fakeInputEventListeners.blur[0]);

            // Handling key events properly cross-browser is a pain in the ass.
            // For now we provide basic cross-browser support by taking into account that Chrome
            // does not fire keypress event when key is not printable (notable exceptions are Backspace or Enter)
            // but Firefox does.
            fakeInputEventListeners.keypress.unshift(function (e) {
                if (e.which !== 13 && e.charCode !== 0) { // not "Enter" and printable key (simplified check for now...)
                    plugin._handleCharKey($target, e.key);
                    plugin._showCaret($target);
                }
            });
            target.addEventListener("keypress", fakeInputEventListeners.keypress[0]);

            fakeInputEventListeners.keydown.unshift(function (e) {
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
            target.addEventListener("keydown", fakeInputEventListeners.keydown[0]);
        },


        //////////////////////////////////////////////////////////////////////////////////
        //                                                                              //
        //                    NATIVE SELECTORS INTEGRATION API                          //
        //                                                                              //
        //////////////////////////////////////////////////////////////////////////////////

        /**
         * Performs a selector-based query against a native selector API function, gathering fake inputs elements
         * if an input tag selector is provided or validation API selectors like :invalid, :valid and :required.
         * @param {String} extensionName - name of a the extension of the selector API
         * @param {String} fnName - name of a selector API function
         * @param {String} selector - the selector to query
         * @returns {*} the result of the native call
         * @private
         */
        _querySelector: function (extensionName, fnName, selector) {
            var match,
                markerUsesNativeSelector = plugin.markerClassName + "-uses-native-selector",

                // instead of doing any kind of parsing on the selector to detect if the input tag is present
                // we execute a dummy replace with the plugin class name and catch the error thrown
                // if this switch formed a invalid selector (for instance if the word "plugin" is not a tag name
                // in the selector but part of something else like .input, #input, .myinputName, etc.)
                //
                // Note validation API selectors: it exists other selectors like :in-range or :out-of-range related to the validation
                // when attributes min & max are provided on an input of type number. But as we only handle type='text', those
                // should not be treated.
                modifiedSelector = selector.replace(/input|:invalid|:valid|:required/g, function (match) {
                    if (match === "input") {
                        return "." + markerUsesNativeSelector;
                    }

                    // return the class postfixed with the validation pseudo-class (without the ':') => -invalid, -valid or -required
                    // Note: this is of no consequences if the user set the option integrateValidations to false.
                    return "." + markerUsesNativeSelector + "." + plugin.markerClassName + "-" + match.substring(1);
                });
            ;

            try {
                if (modifiedSelector !== selector) {
                    match = selectorAPI[extensionName][fnName].call(this, modifiedSelector + ", " + selector);
                    if (match !== null) {
                        // remove our dopplegangers before returning the result
                        return selectorAPI.jquery.not.call($(match), '.inert');
                    }
                }
            } catch(e) {};

            return selectorAPI[extensionName][fnName].call(this, selector);
        },

        /**
         * Overrides the selector API to match the fake inputs when the input tag is present in a selector.
         * @private
         */
        _impersonateInputSelectors: function ($target) {
            var target = $target[0],
                jqFnNames = ["is", "find", "filter", "not"],
                markerUsesNativeSelector = this.markerClassName + "-uses-native-selector"
            ;

            $target.addClass(markerUsesNativeSelector);

            // As .matches is called on an element, we need to capture the context as well on this one
            target.matches = function (selector) {
                return plugin._querySelector.call(this, "native", "matches", selector);
            };

            if (selectorAPI.initialized === true) { // global selectors already initialized
                return;
            }

            document.querySelector = plugin._querySelector.bind(document, "native", "querySelector");

            document.querySelectorAll = plugin._querySelector.bind(document, "native", "querySelectorAll");

            // We need to override jquery selector methods too. Even though they make use of
            // native API under the hood, the Sizzle engine actually saves references to the
            // native functions before our override code even run!
            jqFnNames.forEach(function (name) {
                var capitalized = name[0].toUpperCase() + name.substring(1);

                // Those jquery selector functions are also called from inside jQuery code,
                // meaning the context can change between $.fn and window.
                // So we also need to capture the context of the current call.
                $.fn[name] = function (selector) {
                    // jquery support other type of arguments (jquery object, html element etc...) we don't want to override
                    if (typeof selector === "string") {
                        return plugin._querySelector.call(this, "jquery", "jq" + capitalized, selector);
                    }
                    return selectorAPI.jquery["jq" + capitalized].call(this, selector);
                };
            });

            selectorAPI.initialized = true; // mark as already initialized
        },

        /**
         * Stop the impersonation of native selectors.
         * The fake input will no longer appear for input selectors.
         *
         * @param $target - the fake jquery input
         * @private
         */
        _stopSelectorsImpersonation: function ($target) {
            $target.removeClass(this.markerClassName + "-uses-native-selector");
            $target[0].matches = selectorAPI.native.matches;

            if (!$(this.markerClassName).length) { // no remaining fake inputs
                selectorAPI.initialized = false;
            }
        },



        //////////////////////////////////////////////////////////////////////////////////
        //                                                                              //
        //                           CONSTRAINT VALIDATION API                          //
        //                                                                              //
        //////////////////////////////////////////////////////////////////////////////////


        /**
         * Impersonate the validation API on the fake input and the parent form.
         * WARNING: the parent form is a accessed via a closure and is not marked with a plugin marker class name.
         * If the client code move the fake input around into a new form, the new form will not be impersonated.
         * If the parent form is replaced or removed, the closured form element will not be garbage-collected.
         * If the novalidate attribute of the form is changed by the client code, our custom form validation will fail
         * etc...
         *
         * @param $target - the fake input node
         * @private
         */
        _impersonateValidations: function ($target) {
            var target = $target[0],
                $parentForm = $target.closest("form") || {},
                parentForm = $parentForm[0] || {},
                markerUsesValidation = this.markerClassName + "-uses-validation"
            ;

            if (!$target.hasClass(markerUsesValidation)) {
                // Impersonate native validation API properties
                Object.defineProperties(target, {
                    validationMessage: {
                        get: function () {
                            return plugin._queryValidation($target, $realInputProxy, "validationMessage");
                        }
                    },
                    validity: {
                        get: function () {
                            return plugin._queryValidation($target, $realInputProxy, "validity");
                        }
                    },
                    willValidate: {
                        get: function () {
                            return plugin._queryValidation($target, $realInputProxy, "willValidate");
                        }
                    }
                });


                // implement checkValidity
                target.checkValidity = function () {
                    var invalidEvent,
                        isValid = plugin._queryValidation.call(null, $target, $realInputProxy, "checkValidity");

                    if (!isValid) {
                        plugin._fireInvalidEvent($target);
                    }

                    return isValid;
                };

                // implement setCustomValidity
                target.setCustomValidity = function (message) {
                    var hasMessage = message.length;

                    plugin._queryValidation.call(null, $target, $realInputProxy, "setCustomValidity", message);

                    plugin._toggleValidityClasses(message.length === 0);
                };

                $target.addClass(markerUsesValidation);
            }


            if (!$parentForm.hasClass(markerUsesValidation)) { // not already initialized
                // we don't want to let the browser check the form validity when the user clicks on a submit button
                // as we have to perform our custom validation.
                // So we save the currently set novalidate boolean reflected attribute and override it to "true".
                // Caveat of this method: the browser will not display its inline bubbles
                $parentForm._novalidate = parentForm.novalidate === true;
                parentForm.novalidate = true;

                // override checkValidity on the form by simply looping over all inputs (fake or not).
                // Also supports the "form" attribute on input elements that allow to attach an external input to a specified form.
                parentForm.checkValidity = function () {
                    var isValid = true;

                    $parentForm.find("input").add($("[form=" + parentForm.id + "]")).each(function (index, elt) {
                        isValid = isValid && elt.checkValidity(); // either our fake input or a native one if mix
                        return isValid; // if false, this breaks the jQuery loop
                    });

                    if (!isValid) {
                        plugin._fireInvalidEvent($parentForm);
                    }

                    return isValid;
                };


                // perform the validation ourselves if the form should be validated
                $parentForm.on("submit." + this.propertyName, function () {
                    if ($parentForm._novalidate === false) { // if the form was meant to be validated
                        // calls our impersonated checkValidity
                        return this.checkValidity(); // <=> prevent default + stop bubbling
                    }
                });

                // support for formnovalidate attribute on submit inputs/buttons that can forbid
                // a form from triggering validation even if its novalidate attribute was not set
                $parentForm.find("[type=submit]").on("click." + this.propertyName, function () {
                    $parentForm._novalidate = $parentForm._novalidate && this.formnovalidate === true;
                });

                $parentForm.addClass(markerUsesValidation); // mark as already initialized
            }
        },


        /**
         * Fire the invalid event. This normally happens when:
         *   - checkValidity is called manually on an input or form element
         *   - the form is submitted
         * @param $target
         * @private
         */
        _fireInvalidEvent: function ($target) {
            var invalidEvent = new Event("invalid", {
                bubbles: false,
                cancelable: true
            });
            $target[0].dispatchEvent(invalidEvent);
        },


        /**
         * To avoid reimplementing the native validation API in plain javascript, the trick is to use
         * our real inert input to perform the validation given our current fake node state (attributes & values).
         * To detect if the property is an attribute or a property, we make use of our predefined object validationAPI that keeps
         * track of the types and names of various properties.
         *
         * @param $target - the fake jQuery input node
         * @param $input - a real input text
         * @private
         */
        _impersonateHtmlValidation: function ($target, $input) {
            var target = $target[0];

            validationAPI.htmlAttrs.forEach(function (attr) {
                if (target.hasAttribute(attr)) {
                    $input.attr(attr, $target.attr(attr));
                }
            });

            validationAPI.htmlProps.forEach(function (prop) {
                if (target.hasAttribute(prop)) {
                    $input.prop(prop, true);
                }
            });

            $input.val($target.val());
        },


        /**
         * Clear the data (attributes & values) set on our real input from a call to _impersonateHtmlValidation
         *
         * @param $target - the fake jQuery input node
         * @param $input - a real input text
         * @private
         */
        _clearHtmlValidation: function ($target, $input) {
            validationAPI.htmlAttrs.forEach(function (attr) {
                $input.removeAttr(attr);
            });
            validationAPI.htmlProps.forEach(function (prop) {
                $input.prop(prop, false); // do not use removeProp as once a native prop is removed it cannot be added again
            });

            $input.val('');
        },


        /**
         * Retrieve the validation API property on a real input. The property can be either a simple attribute or a function to call.
         * To detect if the property is a function call or an attribute, we make use of our predefined object validationAPI that keeps
         * track of the types and names of various properties.
         *
         * @param {jQuery} $target - the fake jquery input
         * @param {String} name - the name of the validation property to retrieve
         * @returns {*} the retrieved property
         * @private
         */
        _queryValidation: function ($target, $input, name) {
            var ret,
                args,
                input = $input[0]
            ;

            plugin._clearHtmlValidation($target, $input);

            plugin._impersonateHtmlValidation($target, $input);

            if (validationAPI.fns.indexOf(name) !== -1) { // the property is a function
                args = Array.prototype.slice.call(arguments);
                ret = input[name].apply(input, args.slice(3));
            } else if (validationAPI.oAttrs.indexOf(name) !== -1) { // the property is an attribute
                ret = input[name];
            } else {
                throw new TypeError("invalid argument: " + name);
            }

            return ret;
        },

        /**
         * Toggle -invalid or -valid custom classes reflecting the :invalid and :valid states of the fake input.
         *
         * @param $target - the fake jQuery input
         * @param isValid - if true, toggles the valid class, else toggles the invalid class
         * @private
         */
        _toggleValidityClasses: function ($target, isValid) {
            $target.toggleClass(this.markerClassName + "-invalid", !isValid)
                .toggleClass(this.markerClassName + "-valid", isValid);
        },


        /**
         * Stop the impersonation of validation API.
         * The fake input will no longer appear for :invalid, :valid or :required selectors.
         *
         * @param $target - the fake jquery input
         * @private
         */
        _stopValidationsImpersonation: function ($target) {
            var target = $target[0],
                markerUsesValidation = this.markerClassName + "-uses-validation",
                $parentForm = $target.closest("form." + markerUsesValidation),
                parentForm = $parentForm[0]
            ;

            $target.removeClass(this.markerClassName + "-invalid", this.markerClassName + "-valid", markerUsesValidation);

            validationAPI.oAttrs.forEach(function (attr) {
                delete target[attr];
            });

            validationAPI.fns.forEach(function (fn) {
                delete target[fn];
            });

            // if the form was marked for validation and there are no remaining children using validation, stop form validation as well
            if ($parentForm.length && !$parentForm.find(markerUsesValidation).length) {
                $parentForm.removeClass(markerUsesValidation);
                delete parentForm._novalidate;
                parentForm.checkValidity = HTMLFormElement.prototype.checkValidity;
                $parentForm.off("submit." + this.propertyName);
                $parentForm.find("[type='submit']").off("click." + this.propertyName);
            }
        },




        //////////////////////////////////////////////////////////////////////////////////
        //                                                                              //
        //                               DESTROY PLUGIN                                 //
        //                                                                              //
        //////////////////////////////////////////////////////////////////////////////////


        /**
         * Public method to destroy the plugin instance on the target element.
         * Not that it uses .replaceChild internally so this is a full destroyer: any data, listeners, plugins...
         * attached to the fake input will be lost as well
         * => ALWAYS CALL THIS METHOD AFTER REMOVING ANYTHING ELSE ATTACHED TO IT.
         *
         * @param target - the fake input node
         * @private
         */
        _destroyPlugin: function (target) {
            var $target = $(target),
                fakeTextNode = $target.children()[0],
                inst = $target.data(this.markerClassName),
                eventName
            ;

            if (!$target.hasClass(this.markerClassName)) { // if plugin not initialized
                return;
            }

            this._stopSelectorsImpersonation($target);
            this._stopValidationsImpersonation($target);

            // we replace the element without first removing its native (non-jquery) event listeners.
            // We want to remove them manually to avoid any memory leaks issues but instead of keeping tracks
            // of which element has which listeners, we will simply destroy them all when not more fake inputs are remaining.
            $target.replaceWith(inst.originalElement); // jquery removes its own events listeners + data (also on children aka fake text node)

            if ($(this.markerClassName).length === 0) { // no remaining fake inputs
                for (eventName in fakeTextNodeEventListeners) {
                    fakeTextNode.removeEventListener(eventName, fakeTextNodeEventListeners[eventName].pop()); // note: pop is faster than shift
                }

                for (eventName in fakeInputEventListeners) {
                    target.removeEventListener(eventName, fakeInputEventListeners[eventName].pop());
                }

                $fakeCaret.remove();
                $fakeCaret = $();
                $realInputProxy.remove();
                $realInputProxy = $();
            }

            // Note: we do not remove the inserted css rule when first creating the plugin.
            // This is faster if the plugin is re-used after being destroyed.
        }
    });

    var plugin = $.fakeinput = new FakeInput();


    /**
     * Boilerplate jquery plugin code: Determine whether a method is a getter and doesn't permit chaining.
     * @param method {String} (Optional) the method to run
     * @param otherArgs {Array} (Optional) any other arguments for the method
     * @returns {boolean} true if the method is a getter, false if not
     */
    function isNotChained (method, otherArgs) {
        if (method === 'option' && (otherArgs.length == 0 ||
            (otherArgs.length === 1 && typeof otherArgs[0] === 'string'))) {
            return true;
        }
        return $.inArray(method, getters) > -1;
    }


    $.fn.fakeinput = function (options) {
        var otherArgs = Array.prototype.slice.call(arguments, 1);

        if (isNotChained(options, otherArgs)) { // if the method is a getter, returns method's value directly
            return plugin['_' + options + 'Plugin'].apply(plugin, [this[0]].concat(otherArgs));
        }

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