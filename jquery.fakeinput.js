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

    var $currentlyFocused = $();
    var $fakeCaret = $(); // only one care instance for everyone
    var $textWidthCalculator = $();


    function FakeInput() {
        this.defaults = {
            rightAdjustment: 3,
            leftAdjustment: 1,
        };
    }

    $.extend(FakeInput.prototype, {
        markerClassName: 'fab-fakeinput',
        propertyName: 'fab-fakeinput',

        setDefaults: function (options) {
            $.extend(this.defaults, options || {});
            return this;
        },

        _attachPlugin: function (target, options) {
            $target = $(target);
            var inst;

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
                .html("<span class='" + this.markerClassName + "-textnode'>" + ($target.attr("value") || "") + "</span>"); // fake text node

            this._setCaretPlugin();
            this._impersonateInputStyle($target);
            this._impersonateInputAttributes($target);
            this._initEvents($target);

            this._optionPlugin($target, options);
        },



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
         * @param {jQuery} $target - the fake input
         * @private
         */
        _impersonateInputStyle: function ($target) {
            var $realInput = $('#' + this.markerClassName + '-impersonated-input'),
                stylesToRestore = {},
                computedInputStyle = {},
                realInputStyle = null,
                fakeInputStyle = {
                    overflow: "hidden",
                    cursor: "text"
                }
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
                computedInputStyle = window.getComputedStyle($realInput[0]);
                realInputStyle = StyleHelper.addCSSRule('.' + this.markerClassName + '{' +
                    computedInputStyle.cssText +
                '}');

                $.extend(stylesToRestore, fakeInputStyle); // combine styles to restore + fake input specific styles

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
         * @param {jQuery} $target - the fake input
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
         * Retrieves the the new caret coordinates in pixels based on current selectionStart/selectionEnd of the fake input.
         * The coordinates are bound between left and right edges of the fake input.
         *
         * @param {jQuery} $target - the fake input
         * @returns {top: number, left: number} - the top-left coordinate of the caret
         * @private
         */
        _getNewCaretCoordinates: function ($target) {
            var target = $target[0],
                rightAdjustment = this._optionPlugin($target, "rightAdjustment"),
                $fakeTextNode = $target.children(),
                realTextNode = $fakeTextNode[0].childNodes[0],
                range = document.createRange(),
                rangeRect,
                targetRect,
                adjustedRangeRectLeft,
                adjustedTargetRectRight,
                newTop,
                newLeft
            ;

            if (realTextNode === undefined) {
                realTextNode = document.createTextNode("");
                $fakeTextNode.append(realTextNode);
            }

            // create range from first char to selectionEnd
            range.setStart(realTextNode, 0);
            range.setEnd(realTextNode, target.selectionEnd);

            rangeRect = range.getBoundingClientRect();
            targetRect = target.getBoundingClientRect();

            // rectangle objects are readonly, so we have to introduce new variables to adjust the values
            adjustedRangeRectLeft = rangeRect.left - (parseInt($fakeTextNode.css("left"), 0) || 0);
            adjustedTargetRectRight = targetRect.right - rightAdjustment;

            newTop = targetRect.top;
            newLeft = rangeRect.right;

            // prevent going outside fake input borders
            if (rangeRect.right > adjustedTargetRectRight) {
                newLeft = adjustedTargetRectRight;
            }
            if (adjustedRangeRectLeft < targetRect.left) {
                newLeft = targetRect.left;
            }

            return {
                top: Math.max(newTop, 0),
                left: Math.max(0, newLeft)
            };
        },


        /**
         * Retrieves the selection boundaries inside the fake input.
         * If the selection is collapsed, the start and the end of the selection are equal.
         *
         * @param {jQuery} $target - the fake input
         * @returns {start: number, end: number} - the selection boundaries
         * @private
         */
        _getSelectionRangePos: function ($target) {
            var start = -1, end = -1,
                $fakeTextNode = $target.children(),
                userSelection = window.getSelection()
            ;

            if (userSelection.anchorNode === userSelection.focusNode && // selection doesn't cross nodes
                userSelection.anchorNode === $fakeTextNode[0].childNodes[0]) { // selection is within our text node
                start = userSelection.anchorOffset; // the index of start of the selection
                end = userSelection.focusOffset; // the index of the end of the selection
            }

            return {
                start: start,
                end: end
            };
        },

        /**
         * Returns the width of the chars located numChars before or after the current caret position.
         *
         * @param {jQuery} $target - the fake input
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
         *  - pressed the arrow right key at the far right end of the fake input
         * When value param is undefined, shift min(right overflow, fake input width / 2)
         *
         * @param {jQuery} $target - the fake input
         * @param {Number} value (Optional) - the number of pixels to shift
         * @private
         */
        _shiftTextNodeLeft: function ($target, value) {
            var totalWidth,
                visibleWidth,
                $fakeTextNode = $target.children(),
                rightAdjustment = this._optionPlugin($target, "rightAdjustment"),
                target = $target[0]
            ;

            if (value === undefined) {
                totalWidth = target.scrollWidth;
                visibleWidth = target.clientWidth - rightAdjustment;
                // Never shift left beyond width / 2. This situation occurs when:
                //                caret at right edge
                //                 v
                //  +--------------|+
                //  |AAAAAAAAAAAAAA||AAAAAAAAAAAAAAAAAAA... => a lot of overflow
                //  +--------------|+
                //  < - - - - - - - >
                //      width       ^
                //                  end of input
                //
                // => On this configuration, when we insert a new char we don't want to shift left
                // the length of the overflow; instead we have to limit the shift to width / 2
                // (seems to be the value chosen at least by Chrome)
                //
                value = Math.min(totalWidth - visibleWidth, visibleWidth / 2);
            }

            if (value > rightAdjustment) {
                $fakeTextNode.css("left", "-=" + value);
            }
        },


        /**
         * Shift the inner fake text node right after we:
         *   - deleted a portion of the text
         *   - pressed the left arrow at the far left end of the fake input
         * When value param is undefined, shift the width of the char located before the caret
         *
         * @param {jQuery] $target - the fake input
         * @param {Number} value {Optional} - the number of pixels to shift
         * @private
         */
        _shiftTextNodeRight: function ($target, value) {
            var target = $target[0],
                charBeforeCaret,
                $fakeTextNode = $target.children(),
                currentShiftLeft = parseInt($fakeTextNode.css("left"), 0) || 0
            ;

            if (value === undefined) {
                value = this._getCharsWidthRelativeToCaret($target, -1);
            }

            if (currentShiftLeft < 0) {
                $fakeTextNode.css("left", "+=" + value);
            }
        },


        /**
         * Show/Update the caret coordinates based on the current fake input's selectionStart and selectionEnd
         *
         * @param {jQuery} $target - the fake input
         * @private
         */
        _showCaret: function ($target) {
            var coords = this._getNewCaretCoordinates($target);

            $fakeCaret.css({
                // reminder: jquery converts a number to string and append "px" when it detects a number
                top: coords.top,
                left: coords.left,
                height: $target.outerHeight()
            });

            StyleHelper.unmakeInert($fakeCaret[0]);
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
                range = document.createRange()
            ;

            range.setStart($fakeTextNode[0].childNodes[0], textIdx);
            range.setEnd($fakeTextNode[0].childNodes[0], textIdx + text.length);

            return range.getBoundingClientRect().width;
        },


        /**
         * Handle the deletion of one or multiple chars (via selection) after we:
         *  - pressed the backspace key
         *  - pressed the suppr key
         *
         * @param {jQuery} $target - the fake input
         * @private
         */
        _handleDeleteKey: function ($target) {
            var selStart = this.selectionStart,
                selEnd = this.selectionEnd,
                value = this.value,
                target = $target[0]
            ;

            if (selEnd === selStart) { // pas de text selected
                selStart = selStart > 0 ? selStart - 1 : selStart;
            }
            var deletedText = value.slice(selStart, selEnd + 1);
            target.value = value.slice(0, selStart) + value.slice(selEnd);

            target.selectionStart = target.selectionEnd = selStart;

            this._shiftTextNodeRight($target);//, plugin._getTextContentWidth($this, deletedText));
        },


        /**
         * Handle the pressing of the left arrow key.
         * It needs to:
         *   - adjust the fake input new selectionStart/selectionEnd
         *   - shift the fake text node right when we are at the far left edge
         *
         * @param {jQuery} $target - the fake input
         * @private
         */
        _handleLeftArrowKey: function ($target) {
            var caretCoords = plugin._getNewCaretCoordinates($target),
                target = $target[0],
                targetRect = target.getBoundingClientRect(),
                leftAdjustment = plugin._optionPlugin($target, "leftAdjustment"),
                targetLeftEdgeAdjusted = targetRect.left + leftAdjustment,
                charBeforeCaretWidth = plugin._getCharsWidthRelativeToCaret($target, -1)
            ;

            if (caretCoords.left - targetLeftEdgeAdjusted < charBeforeCaretWidth) {
                plugin._shiftTextNodeRight($target, charBeforeCaretWidth + leftAdjustment);
            }

            target.selectionStart = target.selectionEnd = Math.max(target.selectionStart - 1, 0);
        },


        /**
         * Handle the pressing of the right arrow key.
         * It needs to:
         *   - adjust the fake input new selectionStart/selectionEnd
         *   - shift the fake text node left when we are at the far right edge
         *
         * @param {jQuery} $target - the fake input
         * @private
         */
        _handleRightArrowKey: function ($target) {
            var caretCoords = plugin._getNewCaretCoordinates($target),
                target = $target[0],
                targetRect = target.getBoundingClientRect(),
                rightAdjustment = plugin._optionPlugin($target, "rightAdjustment"),
                targetRightEdgeAdjusted = targetRect.right - rightAdjustment,
                charAfterCaretWidth = plugin._getCharsWidthRelativeToCaret($target, 1),
                caretDistanceFromEdge = targetRightEdgeAdjusted - caretCoords.left
            ;

            if (caretDistanceFromEdge < charAfterCaretWidth) {
                plugin._shiftTextNodeLeft($target, caretCoords.left + charAfterCaretWidth - targetRightEdgeAdjusted);
            }

            target.selectionStart = target.selectionEnd = Math.min(target.selectionEnd + 1, target.textContent.length);
        },


        /**
         * Handle the insertion of a new char after pressing an alphanumeric key.
         * It needs to:
         *   - handle the potential shift when we inserted at the far right edge
         *   - replace the current selection with the pressed key char if such selection exists
         *   - adjust the fake input new selectionStart/selectionEnd
         *
         * @param {jQuery} $target - the fake input
         * @param {Char} newChar - the char to insert
         * @private
         */
        _handleCharKey: function ($target, newChar) {
            var selection,
                target = $target[0],
                value = target.value,
                caretCoords,
                targetRect,
                rightAdjustment,
                targetRightEdgeAdjusted,
                charAfterCaretWidth,
                caretDistanceFromEdge
            ;

            selection = window.getSelection();

            if (selection.anchorNode === selection.focusNode &&
                selection.isCollapsed === false) { // only our fake input has selection and is visible
                selection.deleteFromDocument();

                target.selectionStart = target.selectionEnd = selection.anchorOffset;
            }
            target.value = value.slice(0, target.selectionStart) + newChar + value.slice(target.selectionEnd);

            caretCoords = plugin._getNewCaretCoordinates($target);
            targetRect = target.getBoundingClientRect();
            rightAdjustment = plugin._optionPlugin($target, "rightAdjustment");
            targetRightEdgeAdjusted = targetRect.right - rightAdjustment;
            charAfterCaretWidth = plugin._getCharsWidthRelativeToCaret($target, 1);
            caretDistanceFromEdge = targetRightEdgeAdjusted - caretCoords.left;

            if (caretDistanceFromEdge < charAfterCaretWidth) {
                plugin._shiftTextNodeLeft($target);
            }

            target.selectionStart = target.selectionEnd = target.selectionStart + 1;
        },


        /**
         * Init the events handlers for the fake input (should be called once at plugin init).
         *
         * @param {jQuery} $target - the fake input
         * @private
         */
        _initEvents: function ($target) {
            $target.on("click", function (e) {
                var $this = $(this),
                    selectionRange = plugin._getSelectionRangePos($this)
                ;

                // Oddly, when we click to the very far left of the element, the selectionRange detects
                // the adjacent of this one, though we know we are inside the node!
                // This does not seam to occur at the very far right, so we can be safe to assume we are in this
                // situation when we detect -1.
                // Bug WebKit/Blink? Anyway, in that case force selection at the start.
                this.selectionStart = selectionRange.start === -1 ? 0 : selectionRange.start;
                this.selectionEnd = selectionRange.end === -1 ? 0 : selectionRange.end;

                console.log("clicked");
                this.focus();

                e.stopPropagation();
            })
            .on("focus", function () {
                plugin._showCaret($(this));
                $currentlyFocused = $(this);
                console.log("focused");
            })
            .on("blur", function () {
                StyleHelper.makeInert($fakeCaret[0]);
            })
            .on("keypress", function (e) {
                var $this = $(this);

                if (e.which !== 13) { // not "Enter"
                    plugin._handleCharKey($this, e.key);
                    plugin._showCaret($this);
                }
            })
            .on("keydown", function (e) {
                var $this = $(this);

                if (e.which === 8 || e.which === 46) { // backspace or del
                    plugin._handleDeleteKey($this);
                    plugin._showCaret($this);

                    return false; // prevent default & stop bubbling
                }
                if (e.which === 37) { // left arrow
                    plugin._handleLeftArrowKey($this);
                    plugin._showCaret($this);

                } else if (e.which == 39) { // right arrow
                    plugin._handleRightArrowKey($this);
                    plugin._showCaret($this);
                }
            });

            $(document).on("click", function (e) {
                if (!$(e.target).is('.' + plugin.markerClassName)) {
                    if ($currentlyFocused.length) {
                        $currentlyFocused[0].blur();
                        console.log("blurred");
                    }
                }
            });


        }


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