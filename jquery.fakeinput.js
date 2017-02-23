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
 * - auto-focus from click on matching label
 * - support for impersonating jquery event delegation (2nd argument of on() method)
 * - full support for special jquery filters like :visible. Partially supported for simple selector (see notes).
 * - support for detecting if impersonated attributes are removed/reset from the client (DOM Mutation Observers)
 * - impersonation of document.getElementsByTagName("input") returns Array instead of Live HTMLCollection
 * - impersonation of selector API or DOM Level 1 node retreival on elements other than document (subtrees)
 * - impersonation of constraint validation API does not bother checking if the element has a datalist ancestor (should be barred from constraint validation as per spec)
 */

(function (factory) {
    if (typeof define === "function" && define.amd) {
        // AMD. Register as an anonymous module.
        define([
            "jquery",
            "stylehelper",
            "selectorspy"
        ], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node/CommonJS
        module.exports = factory(require("jquery"), require("stylehelper"), require("selectorspy"));
    } else {
        // Browser globals
        factory(jQuery, StyleHelper, SelectorSpy);
    }
}(function ($, StyleHelper, SelectorSpy) {

    var styleCount = 0;

    var getters = []; // here should go the name of the plugin getter methods
                      // (we used to have one but removed - leave it in case we go back to it in the future)

    var $realInputProxy = $(); // only one input proxy instance for everyone

    var validationAPI = {
        htmlAttrs:  ["type", "pattern", "minlength", "maxlength", "min", "max"],
        // don't forget "readonly" and "disabled" as the element is "barred from constraint validation" if present (cf standard spec)
        htmlProps: ["required", "novalidate", "formnovalidate", "readonly", "disabled"],
        oAttrs: ["validationMessage", "willValidate", "validity"],
        fns: ["checkValidity", "setCustomValidity"]
    };

    // simple events manager for plain-js/non-jquery events
    var eventListenerManager = {
        childEvents: ["mousedown", "click", "mouseup", "dblclick", "mousemove", "mouseover", "mouseout", "mousewheel",
            "touchstart", "touchend", "touchcancel"], // all child of a fake input will intercept those events

        listeners: [], // listeners stack

        addListener: function (event, elem, listener) {
            this.listeners.unshift({
                event: event,
                elem: elem,
                listener: listener
            });
            elem.addEventListener(event, listener);
        },

        removeAllListeners: function () {
            this.listeners.forEach(function (saved) {
                saved.elem.removeEventListener(saved.event, saved.listener);
            });
            this.listeners = [];
        },

        removeListeners: function (elem) {
            var remaining = [];
            this.listeners.forEach(function (saved) {
                if (saved.elem === elem) {
                    elem.removeEventListener(saved.event, saved.listener);
                } else {
                    remaining.push(saved);
                }
            });
            this.listeners = remaining;
        }
    };


    function FakeInput() {
        this.defaults = {
            ignoredStyleProperties: [], /* List of css properties to ignore when calculating the fake input style.
             When calculating the style of real input in the current context, a CSS rule with
             the computed style will be inserted as a class and applied to the element.
             But there are cases where we actually don't want to apply a certain computed property because
             it will override an inherited style due to selectivity.
             For instance, if a computed visibility is hidden because of a parent being hidden by inheritance,
             if the user later changes the parent visibility to visible, the element will still preserve its
             hidden visibility as it is still present in the css rule applied to it, which would typically not
             be the expected behaviour from the user's perspective.
             One way to automate this would be to discard any inherited properties, but figuring out what is
             inherited and what is not when using getComputedStyle() is a no-go, so instead we let the user
             handle individual cases manually. */
            fireInput: true,            /* wether the "input" event should be fired */
            fireChange: true,           /* wether the "change" event should be fired */
            integrateSelectors: true,   /* wether to override the selector API to impersonate input tag in a selector */
            integrateValidations: true, /* wether to override the validation API  */
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
                currentValue = $target.prop("value") || $target.attr("value") || "",
                inputStyles
                ;

            if (!this._isBrowserCompatible() || $target.hasClass(this.markerClassName) || // no browser support or already attached or it is the proxy input
                $target.hasClass(this.markerClassName + "-proxy")) {
                return;
            }

            inst = {
                options: $.extend({}, this.defaults),
                originalElement: target
            };

            inputStyles = this._getStyleFutureInput($target);

            // We turn the target into our fake input, inheriting all attributes/properties currently assigned inline on
            // the element(whatever the type of the element).
            // Note: this is does not preserve attached event handlers! there is no way to find them in pure javascript!
            // Also jquery remove jquery event handlers + data when replacing.
            $target = $(target.outerHTML.replace(target.tagName.toLowerCase(), "span")).replaceAll($target); // replaceAll returns the new object, whereas replaceWith the old one!

            $target.empty(); // remove all children in case the element had children

            target = $target[0];

            $target.data(this.propertyName, inst);

            this._impersonateInputStyle($target, inputStyles); // do this before adding child textnode!

            $target.attr("tabindex", "1") // make it focusable/tabbable
                .html("<div class='" + this.markerClassName + "-mask" + "'>" + // block wrapper
                    "<span class='" + this.markerClassName + "-textnode'>" + currentValue + "</span>" + // text node
                    "<span class='"+ this.markerClassName +"-caret' style='visibility: hidden'></span>" + // caret
                    "</div>");

            $target._hasChanged = false; // we will use this to trigger change event if needed

            this._impersonateInputAttributes($target);
            this._initEvents($target);

            this._optionPlugin(target, options);

            if ($target.attr("placeholder")) {
                this._initPlaceHolder($target);
            }
        },


        /**
         * Check if browser supports range API & selection API.
         *
         * @returns {boolean} - wether or not the browser is compatible
         * @private
         */
        _isBrowserCompatible: function () {
            var $body = $("body"),
                cached = $body.data(this.propertyName + "-support"),
                isCompatible = cached
                ;

            if (cached === undefined) {
                isCompatible = (typeof document.createRange === "function") &&
                    (typeof document.caretPositionFromPoint === "function" || typeof document.caretRangeFromPoint === "function") &&
                    (typeof document.getSelection === "function");

                $body.data(this.propertyName + "-support", isCompatible); // cache results
            }

            return isCompatible;
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

            inst.options.ignoredStyleProperties.forEach(function (prop) {
                StyleHelper.removeProp("." + $target.attr("class").match(new RegExp(plugin.markerClassName + "-\\d+"))[0], prop);
            });

            // validations integration neeeds selector integrations, so in either case we impersonate selectors
            if (inst.options.integrateSelectors === true || inst.options.integrateValidations === true) {
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
         * Returns the fake input caret.
         * Note: earlier implementation used to have only one caret instance for every fake inputs.
         * This was dropped because it required being absolutely positioned, which breaks when
         * css transform translation on a container.
         *
         * @param $target - the fake jquery input
         * @returns {jQuery} the fake caret
         * @private
         */
        _getCaret: function ($target) {
            return $target.children().children('.' + this.markerClassName + "-caret");
        },


        /**
         * Returns the fake input inner text node.
         * @param $target - the fake jquery input
         * @returns {jQuery} the fake text node
         * @private
         */
        _getTextNode: function ($target) {
            var $fakeTextNode = $target.children().children('.' + this.markerClassName + "-textnode"),
                realTextNode = $fakeTextNode[0].childNodes[0]
                ;

            if (realTextNode === undefined) {
                realTextNode = document.createTextNode("");
                $fakeTextNode.append(realTextNode);
                $target[0].selectionStart = $target[0].selectionEnd = 0;
            }

            return $fakeTextNode;
        },



        /**
         * Calculate style to apply to the future fake input.
         *
         * @param {jQuery} $target - the fake jquery input
         * @returns {{ css prop: {String}, css value: {String} }}
         * @private
         */
        _getStyleFutureInput: function ($target) {
            var $input,
                target = $target[0],
                stylesToRestore = {},
                visibleComputedStyle
                ;

            // is our element already a real input text?
            // We used to override jQuery.is() but we don't anymore, maybe later ?
            if ((SelectorSpy.retreive($.fn, "is") || $.fn.is).call($target, "input[type='text']")) {
                $input = $target;
                visibleComputedStyle = StyleHelper.getVisibleComputedStyle($input[0]);
            } else { // we create a fake input in the context of its parent
                $input = $(target.outerHTML.replace(target.tagName.toLowerCase(), "input")).removeAttr("id");
                StyleHelper.makeInert($input, stylesToRestore);
                $target.after($input);
                visibleComputedStyle = StyleHelper.getVisibleComputedStyle($input[0]);
                $input.remove();

                for (var prop in stylesToRestore) { // restore styles affected by inert
                    if (stylesToRestore.hasOwnProperty(prop)) {
                        visibleComputedStyle[prop] = stylesToRestore[prop];
                    }
                }
            }
            return visibleComputedStyle;
        },


        /**
         * Impersonate the styles of a real input text in the context of its parent.
         *
         * @param {jQuery} $target - the fake jquery input
         * @param {CSSStyleDeclaration|CSS2Properties|Object} see Stylehelper.getVisibleComputedStyle
         * @private
         */
        _impersonateInputStyle: function ($target, computedStyle) {
            styleCount++;

            // Save a new CSS class rule based on the calculated style.
            // This is convenient instead of inline styling because:
            //  - we can simply toggle the class on future fake inputs
            //  - it keeps the code DRY as the styles are not repeated inline
            //  - it doesn't bloat the DOM inspector with very long lines of inline styles
            StyleHelper.addCSSRule('.' + this.markerClassName + '-' + styleCount, computedStyle);

            $target.addClass(this.markerClassName + ' ' + this.markerClassName + '-' + styleCount);
        },



        /**
         * Impersonate the relevant attributes specific to a real text input.
         *
         * @param {jQuery} $target - the fake jquery input
         * @private
         */
        _impersonateInputAttributes: function ($target) {
            var target = $target[0],
                $fakeTextNode = this._getTextNode($target)
                ;

            // Impersonate DOM's nodeName & tagName as returning "INPUT"
            Object.defineProperties(target, {
                "nodeName": {
                    value: "INPUT"
                },
                "tagName": {
                    value: "INPUT"
                }
            });

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
                    if (!val) {
                        target.selectionStart = target.selectionEnd = 0;
                    }
                }
            });

            // set selection attributes at the end
            target.selectionStart = target.selectionEnd = $fakeTextNode.text().length;

            target.name = $target.attr("name"); // this breaks if the name is later set via .attr(), we could use getter instead
        },



        /**
         * Retrieves the the new caret coordinates based on current selectionStart/selectionEnd of the fake input.
         * Note: the implementation changed from absolute to relative coordinates (when there was only one caret instance).
         * So the top relative coordinate is superfluous (always 0) but we leave it so that the rest of the code
         * can remain mostly unchanged if we ever change this again).
         *
         * @param {jQuery} $target - the fake jquery input
         * @returns {{top: number, left: number}} - the top-left coordinate of the caret
         * @private
         */
        _getRelativeCaretCoordinates: function ($target) {
            var target = $target[0],
                $fakeTextNode = this._getTextNode($target),
                realTextNode = $fakeTextNode[0].childNodes[0],
                currentShift = parseFloat($fakeTextNode.css("left")),
                range = document.createRange(),
                left, rangeRect
                ;

            range.setStart(realTextNode, 0);
            range.setEnd(realTextNode, target.selectionEnd);

            rangeRect = range.getBoundingClientRect();

            left = rangeRect.width - Math.abs(currentShift);

            return {
                top: 0,
                left: left
            };
        },


        /**
         * Retrieves the new caret coordinates based on current selectionStart/selectionEnd,
         * bounded by the fake input box coordinates and edge adjustments
         * options.
         *
         * @param $target - the fake jquery input
         * @returns {{top: (Number|*), left: (number|*)}} - the bounded caret coordinates
         * @private
         */
        _getBoundedCaretCoordinates: function ($target) {
            var caretCoords = this._getRelativeCaretCoordinates($target),
                wrapperWidth = $target.children().width()
                ;

            caretCoords.left = Math.max(1, caretCoords.left);
            caretCoords.left = Math.min(wrapperWidth, caretCoords.left);

            return {
                top: 0,
                left: caretCoords.left
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
            var $fakeTextNode = this._getTextNode($target),
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
            var $fakeTextNode = this._getTextNode($target);

            $fakeTextNode.css("left", "-=" + value);
        },



        /**
         * Shift the inner fake text node right after we:
         *   - deleted a portion of the text
         *   - pressed the left arrow key at the far left end of the fake input
         *
         * @param {jQuery} $target - the fake jquery input
         * @param {Number} value - the number of pixels to shift
         * @private
         */
        _shiftTextNodeRight: function ($target, value) {
            var $fakeTextNode = this._getTextNode($target),
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
            var coords = this._getBoundedCaretCoordinates($target),
                $fakeCaret = this._getCaret($target)
                ;

            $fakeCaret.css({
                // reminder: jquery converts a number to string and append "px" when it detects a number
                top: coords.top,
                left: coords.left,
                visibility: "visible"
            });
        },


        /**
         * Hide the caret
         *
         * @param $target - the fake jquery input
         * @private
         */
        _hideCaret: function ($target) {
            var $fakeCaret = this._getCaret($target);

            $fakeCaret.css("visibility", "hidden");
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

            this._shiftTextNodeRight($target, Math.floor(deletedTextWidth));
        },


        /**
         * Fire native input event
         * @param $target - the fake jquery input
         * @private
         */
        _fireInputEvent: function ($target) {
            // Note: the spec defines a InputEvent interface but the constructor is not yet
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
            var caretCoordsLeft = this._getRelativeCaretCoordinates($target).left,
                wrapperWidth = $target.children().width(),
                shift
                ;
            // Example right shift algo:
            //
            //                    shift
            //                    <--->
            //   +----------------+
            //   |AAAAAAAAAAAAAAAA|   |
            //   +----------------+   ^
            //   <---------------->  relative caret position
            //         width

            if (caretCoordsLeft > wrapperWidth) {
                shift = Math.floor(caretCoordsLeft - wrapperWidth);
                this._shiftTextNodeLeft($target, shift);
            } else if (caretCoordsLeft < 0) {
                shift = Math.floor(0 - caretCoordsLeft);
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
         * On mouse down, we use new standard API caretPositionFromPoint() ou old API caretRangeFromPoint() if not supported
         * to easily determine which character (offset) was pointed by the mouse.
         *
         * @param $target - the fake jquery input
         * @param e - the event object
         * @private
         */
        _handleMousedown: function ($target, e) {
            var range, caretPosition, offset,
                target = $target[0],
                $fakeTextNode = this._getTextNode($target),
                realTextNode = $fakeTextNode[0].childNodes[0],
                selection = window.getSelection()
                ;

            // this is an over-simplification: real inputs handle moving selection around etc... here we simply discard it.
            if (selection.isCollapsed === false) {
                selection.collapseToStart();
            }

            if (e.offsetX >= $fakeTextNode.width()) { // pointer was beyond the text node, in blank space
                offset = realTextNode.nodeValue.length;
            } else { // pointer was somewhere inside...

                if (document.caretPositionFromPoint) { // current standard, Firefox only
                    caretPosition = document.caretPositionFromPoint(e.clientX, e.clientY);

                    if (caretPosition.offsetNode !== realTextNode) {
                        range = document.createRange();
                        range.setStart(realTextNode, 0);
                        offset = range.startOffset;
                    } else {
                        offset = caretPosition.offset;
                    }

                } else if (document.caretRangeFromPoint) { // old standard, others
                    range = document.caretRangeFromPoint(e.clientX, e.clientY);
                    if (range.startContainer !== realTextNode) {
                        range.setStart(realTextNode, 0);
                    }
                    offset = range.startOffset;
                }
            }

            target.selectionStart = target.selectionEnd = offset;
        },


        /**
         * When the fake input value changes, we can perform some synchronous operations like triggering the "input" event
         * or marking/unmarking the input as valid or invalid
         * @param $target - the fake jquery input
         * @private
         */
        _handleValueChanged: function ($target) {
            var target = $target[0];

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
         * On blur, we hide the caret and dispatch the "changed" even if the input value was changed.
         * Note: Firefox & Chrome handle blur differently:
         *    - Chrome: on blur, the text position is reset to the start (far left)
         *    - Firefox: the text is not repositioned and left as is.
         * Again, we chose the simplest: do not reposition, like Firefox.
         *
         * @param $target - the fake jquery input
         * @private
         */
        _handleBlur: function ($target) {
            var changeEvent;

            this._hideCaret($target);

            if ($target._hasChanged === true && plugin._optionPlugin($target, "fireChange") === true) {
                changeEvent = new Event("change", {
                    bubbles: true,
                    cancelable: false
                });
                $target[0].dispatchEvent(changeEvent);

                $target._hasChanged = false;
            }
        },


        /**
         * On mouseup we detect if a selection was made to adjust the selectionStart & end.
         * In that case, we hide the caret as done by the modern browsers.
         *
         * @param $target - the fake jquery input
         * @private
         */
        _handleMouseup: function ($target) {
            var selection = window.getSelection(),
                target = $target[0]
                ;

            if (selection.anchorNode === selection.focusNode &&
                selection.isCollapsed === false) {
                target.selectionStart = selection.anchorOffset;
                target.selectionEnd = selection.focusOffset;
                this._hideCaret($target);
            }
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
                try {
                    event = new TouchEvent(originalEvent.type, originalEvent);
                } catch (e) {
                    // Android Browser (maybe others?) trigger a TypeError exception
                    // when trying to create a TouchEvent() manually
                    originalEvent.stopImmediatePropagation();
                    return;
                }
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
            var target = $target[0];

            // we don't use jquery events to have total controls in case it gets tricky...
            // Because of this we have to keep track of the event handlers to be able to remove them later with removeEventListener().
            // (We want to do this as to avoid any potential memory leaks)

            // We want to hide the fact that a fake input has children from mouse & touch events
            // (for now we don't care about other events).
            // As a fake input has children, they will be the ones actually receiving the actual event.
            // As such when it bubbles, its "target" attribute will indicate the origin comes from a child node
            // instead of the fake input, breaking the client code that assumes that e.target == fake input
            // (real inputs don't have children).
            // As the "target" attribute is readonly and cannot ever be set/changed, the trick is to
            // listen for the event directly on the children, stop its propagation
            // immediately, and trigger a newly created matching event on the fake input.
            eventListenerManager.childEvents.forEach(function (event) {
                $target.find("*").each(function () {
                    eventListenerManager.addListener(event, this, plugin._impersonateTouchMouseEvent.bind(this, target))
                });
            });

            // mousedown event on fake input will only occur from programmatically created event in the
            // fake inner text node (see above)
            // This sets the caret in-between chars depending on when the user pressed/touched the fake input.
            // Note that when the fake text node is empty, the range will apply on the inner fake caret so
            // we make sure the range concerns the real text node. Other solution would be to catch the event on
            // the fake input and prevent the bubbling, but this solution can remain untouched if we change the
            // fake caret implementation (used to be one instance for every inputs).
            eventListenerManager.addListener("mousedown", target, function (e) {
                plugin._handleMousedown($target, e);

                plugin._showCaret($target);
            });


            // focus & blur events are fired automatically by the browser as the fake inputs were made focusable
            // from adding tabindex

            eventListenerManager.addListener("focus", target, function () {
                plugin._handleFocus($target);
                plugin._showCaret($target);
            });

            eventListenerManager.addListener("blur", target, function () {
                plugin._handleBlur($target);
            });

            // Handling key events properly cross-browser is a pain in the ass.
            // For now we provide basic cross-browser support by taking into account that Chrome
            // does not fire keypress event when key is not printable (notable exceptions are Backspace or Enter)
            // but Firefox does.
            eventListenerManager.addListener("keypress", target, function (e) {
                if (e.which !== 13 && e.charCode !== 0) { // not "Enter" and printable key (simplified check for now...)
                    plugin._handleCharKey($target, e.key);
                    plugin._showCaret($target);
                }
            });

            eventListenerManager.addListener("keydown", target, function (e) {
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

            eventListenerManager.addListener("mouseup", target, function () {
                plugin._handleMouseup($target);
            });
        },


        /**
         * Simple simulated placeholder.
         *
         * @param {jQuery} $target - the fake jquery input
         * @private
         */
        _initPlaceHolder: function ($target) {
            var target = $target[0],
                initialValue = $target.attr('placeholder'),
                initialColor = target.style.color,
                placeholderColor = "rgba(102, 102, 102, 0.69)"
                ;

            $target.css("color", placeholderColor);
            $target.val(initialValue);

            $target.focus(function () {
                var placeholder = $target.attr("placeholder"),
                    value = $target.val();

                if (value === placeholder) {
                    target.selectionStart = target.selectionEnd = 0;
                    plugin._showCaret($target);
                }

                $target.css("color", initialColor);
                $target.val(value.replace(placeholder, ""));
            });

            $target.blur(function () {
                if ($target.val() === '') {
                    $target.css("color", placeholderColor);
                    $target.val(initialValue);
                }
            });
        },


        //////////////////////////////////////////////////////////////////////////////////
        //                                                                              //
        //                           SELECTORS API INTEGRATION                          //
        //                                                                              //
        //////////////////////////////////////////////////////////////////////////////////

        /**
         * Replaces all instances of a tagName in a selector by an impersonator.
         * WARNING: This method uses non-public internal jQuery API to access the tokenize() method of the
         * underlying Sizzle object (can be changed at anytime by jQuery/Sizzle team).
         * Note: the internal tokenize caches all results so we don't need to think about it.
         *
         * @param {String} selector - the selector
         * @param {String} tagName - the tag name to replace in the selector
         * @param {String} impersonator - the stand-in for the tag names
         * @returns {String} the new selector
         * @private
         */
        _impersonateTagName: function (selector, tagName, impersonator) {
            var ret = "";
            var tokens = $.find.tokenize(selector);

            for (var i = 0; i < tokens.length; i++) {
                tokens[i].forEach(function (token) {
                    if (token.type === "TAG" && token.value === tagName) {
                        ret += impersonator;
                    }  else if (token.type === "PSEUDO") {
                        ret += ":" + token.matches[0] +
                            (token.matches[1] ? // pseudo function, like :pseudo(...) => recursivity
                            "(" + plugin._impersonateTagName(token.matches[1], tagName, impersonator) + ")" :
                                ""); // simple pseudo, like :pseudo => nothing to add
                    } else {
                        ret += token.value;
                    }
                });
                ret += ','; // don't forget to add comma
            }
            return ret.replace(/,+$/, ""); // remove trailing commas if any
        },

        /**
         * Performs a selector-based query against a native selector API function, gathering fake inputs elements
         * if an input tag selector is provided or validation API selectors like :invalid, :valid and :required.
         * @param {String} extensionName - name of a the extension of the selector API
         * @param {String} fnName - name of a selector API function
         * @param {String} selector - the selector to query
         * @param {Array} (Optional) otherArgs - the other arguments to transmit
         * @returns {*} the result of the native call
         * @private
         */
        _querySelector: function (context, native, selector, otherArgs) {
            var match, modifiedSelector,
                altered = selector,
                otherArgs = otherArgs || [],
                markerUsesNativeSelector = plugin.markerClassName + "-uses-native-selector"
                ;


            if (selector.indexOf("input") > -1) {
                altered = this._impersonateTagName(selector, "input", "." + markerUsesNativeSelector);
            }

            // Note validation API selectors: it exists other selectors like :in-range or :out-of-range related to the validation
            // when attributes min & max are provided on an input of type number. But as we only handle type='text', those
            // should not be treated.
            altered = altered.replace(/:invalid|:valid|:required/g, function (match) {
                // return the class postfixed with the validation pseudo-class (without the ':') => -invalid, -valid or -required
                // Note: this is of no consequences if the user set the option integrateValidations to false.
                return "." + markerUsesNativeSelector + "." + plugin.markerClassName + "-" + match.substring(1);
            });

            try {
                if (altered !== selector) {

                    match = native([altered + ", " + selector].concat(otherArgs), context);
                    if (match !== null) {
                        return $(match).not(".inert"); // remove .inert elements from the set
                    }
                }
            } catch(e) {}

            return $(native([selector].concat(otherArgs), context)).not(".inert");
        },


        /**
         * Overrides the selector API to match the fake inputs when the input tag is present in a selector.
         * Note: this used to override jquery selectors too but introduced some edge cases hard to debug.
         * If jQuery delegations are used to test for an input text, the client code must adjust for this, like
         * using "[type='text']" instead of "input[type='text']".
         * Also jquery special filters like ":visible" are not supported if the selector is "complex":
         * what jQuery does first is establishing if the selector is "complex" or "simple".
         * If it is complex, it tries to invoke the native qsa API, but if it contains ":visible", this will raise an error that jQuery
         * will capture and pass on to his own implementations.
         * If it is simple enough, jQuery will call native DOM Level 2 API like document.getElementsByTagName() which we impersonate.
         * Examples:
         *  $("input"); // OK
         *  $("input:visible"); // OK
         *  $("input[type='text']"); // OK
         *  $("input[type='text']:visible"); // NOK
         *  $('body').on("keyup", "[type='text'], function () {}); // OK
         *  $('body').on("keyup", "input[type='text'], function () {}); // NOK
         * @private
         */
        _impersonateInputSelectors: function ($target) {
            var markerUsesNativeSelector = this.markerClassName + "-uses-native-selector";


            $target.addClass(markerUsesNativeSelector);

            SelectorSpy.spy(document, "querySelector", function (proxy) {
                return function (selector) {
                    return plugin._querySelector(null, proxy, selector);
                };
            });

            SelectorSpy.spy(document, "querySelectorAll", function (proxy) {
                return function (selector) {
                    return plugin._querySelector(null, proxy, selector);
                };
            });

            SelectorSpy.spy($target[0], "matches", function (proxy) {
                return function (selector) {
                    return plugin._querySelector(null, proxy, selector);
                };
            });

            SelectorSpy.spy(document, "getElementsByTagName", function (proxy) {
                return function (tagName) {
                    if (tagName === "input") {
                        // warning edge-case: we return an array here instead of an HTMLCollection as it's supposed to.
                        // HTMLCollection are "live" in the DOM when array are "static". So if the client code expect
                        // indeed a live collection, we screw it !
                        // (there seem to be no way to add or merge elements to an existing HTMLCollection)
                        return $("input, ." + markerUsesNativeSelector).get();
                    }
                    return proxy(tagName);
                };
            });
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

            if (!$(this.markerClassName).length) { // no remaining fake inputs
                SelectorSpy.unspyAll();
            }
        },



        //////////////////////////////////////////////////////////////////////////////////
        //                                                                              //
        //                           CONSTRAINT VALIDATION API                          //
        //                                                                              //
        //////////////////////////////////////////////////////////////////////////////////


        /**
         * Impersonate the validation API on the fake input and the parent form.
         * WARNING: the parent form is accessed via a closure and is not marked with a plugin marker class name.
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

            if (!$realInputProxy.length) {
                $realInputProxy = $("<input type='text' class='" + this.markerClassName + "-proxy" + "'>");
                StyleHelper.makeInert($realInputProxy[0]);
                $("body").append($realInputProxy);
            }

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
                    },
                    required: {
                        get: function () {
                            return target._expando_required;
                        },
                        set: function (bool) {
                            target._expando_required = bool;
                            if (bool === true) {
                                target.setAttribute("required", "required");
                                plugin._toggleValidityClasses($target, !!target.value);
                            }
                            if (bool === false) {
                                target.removeAttribute("required");
                                plugin._toggleValidityClasses($target, true);
                            }
                        }
                    }
                });


                // implement checkValidity
                target.checkValidity = function () {
                    var isValid = plugin._queryValidation.call(null, $target, $realInputProxy, "checkValidity");

                    if (!isValid) {
                        plugin._fireInvalidEvent($target);
                    }

                    return isValid;
                };

                // implement setCustomValidity
                target.setCustomValidity = function (message) {
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
                    var isValid = true,
                        childrenInputs = $parentForm.find("input")
                        ;

                    if (parentForm.id) {
                        childrenInputs.add($("input[form=" + parentForm.id + "]")); // eventual external inputs
                    }

                    childrenInputs.each(function (index, elt) {
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
         * @param {jQuery} $input - a real input
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
        //                              PLUGIN DESTRUCTION                              //
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
                inst = $target.data(this.propertyName),
                currentVal = $target.val(),
                ruleClass = $target.attr("class").match(new RegExp(this.markerClassName + '-' + '\\d+'))
                ;

            if (!$target.hasClass(this.markerClassName)) { // if plugin not initialized
                return;
            }

            this._stopSelectorsImpersonation($target);
            this._stopValidationsImpersonation($target);

            $target.find("*").addBack().each(function () { // remove all non-jquery listeners attached to the element
                eventListenerManager.removeListeners(this);
            });

            StyleHelper.removeRule('.' + ruleClass); // remove created css rule

            $target.replaceWith(inst.originalElement); // jquery removes its own events listeners + data (also on children aka fake text node)
            $(inst.originalElement).val(currentVal);

            if ($(this.markerClassName).length === 0) { // no remaining fake inputs
                eventListenerManager.removeAllListeners();

                $realInputProxy.remove();
                $realInputProxy = $();
            }
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