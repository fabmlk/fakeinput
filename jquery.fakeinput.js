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
            rightAdjustment: 3
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
            target = $(target);
            var inst;

            if (target.hasClass(this.markerClassName)) {
                return;
            }

            inst = {
                options: $.extend({}, this.defaults),
            };

            if (target.is("input[type='text']")) { // if an input text is specified, replace it
                // here we want to scavenge all attributes/properties assigned inline on the input
                // as input is a children-less element, using outerHTML fits the need.
                // Note: this is does not preserve attached event handlers! there is no way to find them out in pure javascript!
                // Also jquery remove jquery event handlers + data when replacing.
                target = $(target[0].outerHTML.replace("input", "span")).replaceAll(target); // replaceAll returns the new object, whereas replaceWith the old one!
                // target.removeAttr("type"); // remove type='text'
            }


            target.data(this.propertyName, inst)
                .attr("tabindex", "1") // make it focusable/tabbable
                .html("<span class='" + this.markerClassName + "-textnode'>" + (target.attr("value") || "") + "</span>"); // fake text node

            this._setCaretPlugin();
            this._impersonateInputStyle(target);
            this._impersonateInputAttributes(target);
            this._initEvents(target);

            this._optionPlugin(target, options);
        },



        _optionPlugin: function (target, options, value) {
            /* start of boilerplate code common to most jquery plugins */
            target = $(target);
            var inst = target.data(this.propertyName); // retrieve current instance settings

            if (!options || (typeof options == 'string' && value == null)) {
                // Get option
                var name = options;
                options = (inst || {}).options;
                return (options && name ? options[name] : options);
            }

            if (!target.hasClass(this.markerClassName)) { // if plugin not yet initialized
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


        _setCaretPlugin: function (caretChar) {
            caretChar = caretChar || '|';

            if (!$fakeCaret.length) {
                $fakeCaret = $("<span id='" + this.markerClassName + "-fakecaret' class='"+ this.markerClassName +"-fakecaret'></span>");
                StyleHelper.makeInert($fakeCaret[0]);
                $("body").append($fakeCaret);
            }
            $fakeCaret.text(caretChar);
        },



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

                $realInput = $("<input type='text' id='" + this.markerClassName + "-impersonated-input'>");
                stylesToRestore = StyleHelper.makeInert($realInput[0]);
                $("body").append($realInput);

                computedInputStyle = window.getComputedStyle($realInput[0]);
                realInputStyle = StyleHelper.addCSSRule('.' + this.markerClassName +  '{' + computedInputStyle.cssText + ')');

                $.extend(stylesToRestore, fakeInputStyle); // combine styles to restore + fake input specific styles

                for (var prop in stylesToRestore) { // override styles
                    if (stylesToRestore.hasOwnProperty(prop)) {
                        realInputStyle[prop] = stylesToRestore[prop];
                    }
                }
            }

            $target.addClass(this.markerClassName);
        },




        _impersonateInputAttributes: function ($target) {
            var target = $target[0],
                inst = $target.data(this.propertyName),
                adjustedVal
            ;

            Object.defineProperty(target, "value", {
                get: function () {
                    return $target.children().text();
                },
                set: function (val) {
                    $target.children().text(val);
                }
            });

            target.selectionStart = target.selectionEnd = $target.children().text().length;

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


        _getNewCaretCoordinates: function ($target) {
            var target = $target[0],
                rightAdjustment = $target.data(this.propertyName).rightAdjustment,
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

        _getCurrentCaretCoordinates: function () {
            var caretRect = $fakeCaret[0].getBoundingClientRect();

            return {
                top: caretRect.top,
                left: caretRect.left
            };
        },

        _isCaretFarRight: function ($target) {
            var caretCoords = this._getCurrentCaretCoordinates(),
                fakeInputCoords = $target[0].getBoundingClientRect(),
                marginAdjustment = $target.data(this.propertyName).marginAdjustment
            ;

            return caretCoords.left === fakeInputCoords.right - marginAdjustment;
        },


        _getSelectionRangePos: function ($target) {
            var start = -1, end = -1,
                userSelection = window.getSelection()
            ;
            console.log("selection from getSlectionRangePos: ", userSelection);

            if (userSelection.anchorNode === $target.children()[0].childNodes[0]) {
                start = userSelection.anchorOffset;
                end = start + userSelection.toString().length;
            }

            return {
                start: start,
                end: end
            };
        },


        _shiftTextNodeLeft: function ($target, value) {
            var totalWidth,
                visibleWidth,
                $fakeTextNode = $target.children()
            ;

            if (value === undefined) {
                totalWidth = $target[0].scrollWidth;
                visibleWidth = $target[0].clientWidth;
                value = totalWidth - visibleWidth;
            }

            if (value > 0) {
                $fakeTextNode.css("left", "-=" + value);
            }
        },


        _getCharBeforeCursorWidth: function ($target) {
            var target = $target[0],
                charBeforeCursor =  target.value.substr(target.selectionStart - 1, 1);

            return this._getTextContentWidth($target, charBeforeCursor);
        },


        _getCharAfterCursorWidth: function ($target) {
            var target = $target[0],
                charAfterCursor =  target.value.substr(target.selectionEnd, 1);

            return this._getTextContentWidth($target, charAfterCursor);
        },


        _shiftTextNodeRight: function ($target, value) {
            var target = $target[0],
                charBeforeCursor,
                $fakeTextNode = $target.children(),
                currentShiftLeft = parseInt($fakeTextNode.css("left"), 0) || 0
            ;

            if (value === undefined) {
                value = this._getCharBeforeCursorWidth($target);
            }

            if (currentShiftLeft < 0) {
                $fakeTextNode.css("left", "+=" + value);
            }
        },



        _showCursor: function ($target) {
            var coords = this._getNewCaretCoordinates($target);

            $fakeCaret.css({
                // reminder: jquery converts a number to string and append "px" when it detects a number
                top: coords.top,
                left: coords.left,
                height: $target.outerHeight()
            });

            StyleHelper.unmakeInert($fakeCaret[0]);
        },


        _getTextContentWidth: function ($target, text) {
            var $fakeTextNode = $target.children(),
                textIdx = $fakeTextNode.text().indexOf(text),
                range = document.createRange()
            ;

            range.setStart($fakeTextNode[0].childNodes[0], textIdx);
            range.setEnd($fakeTextNode[0].childNodes[0], textIdx + text.length);

            return range.getBoundingClientRect().width;
        },


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
                plugin._showCursor($(this));
                $currentlyFocused = $(this);
                console.log("focused");
            })
            .on("blur", function () {
                StyleHelper.makeInert($fakeCaret[0]);
            })
            .on("keypress", function (e) {
                var selection, value = this.value;

                if (e.which !== 13) { // not "Enter"
                    selection = window.getSelection();
                    if (selection.anchorNode === selection.focusNode && selection.isCollapsed === false) { // only our fake input has selection and is visible
                        selection.deleteFromDocument();

                        this.selectionStart = this.selectionEnd = selection.anchorOffset;
                    }
                    this.value = value.slice(0, this.selectionStart) + e.key + value.slice(this.selectionEnd);

                    this.selectionStart = this.selectionEnd = this.selectionStart + 1;

                    plugin._shiftTextNodeLeft($(this));

                    plugin._showCursor($(this));
                }
            })
            .on("keydown", function (e) {
                var selStart = this.selectionStart,
                    selEnd = this.selectionEnd,
                    value = this.value,
                    $this = $(this)
                ;

                if (e.which === 8 || e.which === 46) { // backspace or del
                    if (selEnd === selStart) { // pas de text selected
                        selStart = selStart > 0 ? selStart - 1 : selStart;
                    }
                    var deletedText = value.slice(selStart, selEnd + 1);
                    this.value = value.slice(0, selStart) + value.slice(selEnd);

                    this.selectionStart = this.selectionEnd = selStart;

                    plugin._shiftTextNodeRight($(this));//, plugin._getTextContentWidth($this, deletedText));

                    plugin._showCursor($this);

                    return false; // prevent default & stop bubbling
                }
                if (e.which === 37) { // left arrow
                    this.selectionStart = this.selectionEnd = Math.max(this.selectionStart - 1, 0);

                    var caretCoords = plugin._getNewCaretCoordinates($this),
                        targetRect = this.getBoundingClientRect(),
                        charBeforeCursorWidth = plugin._getCharBeforeCursorWidth($this)
                    ;

                    if (caretCoords.left - targetRect.left < charBeforeCursorWidth) {
                        plugin._shiftTextNodeRight($this, charBeforeCursorWidth);
                    }

                    plugin._showCursor($this);

                } else if (e.which == 39) { // right arrow
                    this.selectionStart = this.selectionEnd = Math.min(this.selectionEnd + 1, this.textContent.length);

                    var caretCoords = plugin._getNewCaretCoordinates($this),
                        targetRect = this.getBoundingClientRect(),
                        charAfterCursorWidth = plugin._getCharAfterCursorWidth($this)
                    ;

                    if (caretCoords.left - targetRect.right < charAfterCursorWidth) {
                        plugin._shiftTextNodeLeft($this, charAfterCursorWidth);
                    }

                    plugin._showCursor($this);
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