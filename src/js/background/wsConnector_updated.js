/*
 * Copyright The UIO+ copyright holders
 * See the AUTHORS.md file at the top-level directory of this distribution and at
 * https://github.com/GPII/gpii-chrome-extension/blob/master/AUTHORS.md
 *
 * Licensed under the New BSD license. You may not use this file except in
 * compliance with this license.
 *
 * You may obtain a copy of the license at
 * https://github.com/GPII/gpii-chrome-extension/blob/master/LICENSE.txt
 */

/* global fluid, chrome */
"use strict";

(function (fluid) {
    var gpii = fluid.registerNamespace("gpii");

    /*
        The `gpii.chrome.websocket` grade provides a system for creating a port connection and sending/receiving
        messages across that port. To verify that messages sent across a port are received and acted upon correctly,
        posts provide a promise that is resolved/rejected based on a returned receipt. Connections are also set to
        return receipts after an incoming message has been handled.

        Workflow:
        post - ( sends payload with message id )
             - message id gets stored in a map with the promise to resolve/reject
             -  receiver takes action of the message and returns a receipt ( includes the same message id )

        receive - (receives a message)
                - if it is a returned receipt
                  - look into message map and resolve/reject corresponding promise
                  - remove from map
                - if it is a new message
                  - take action on the message
                  - send a return message (receipt) containing the same message id


        Post Messages:
        1) read/write message
           - wait for receipt
        2) read-receipt/write-receipt
           - do not wait for receipt

        Received Messages:
        1) read/write message
           - action, return receipt
        2) read-receipt/write-receipt
           - remove from message map

        By default the following message types are handled.
        - "gpii.chrome.readRequest"
        - "gpii.chrome.readReceipt"
        - "gpii.chrome.writeRequest"
        - "gpii.chrome.writeReceipt"

        By default the following message types are sent.
        - "gpii.chrome.readRequest"
        - "gpii.chrome.readReceipt"
        - "gpii.chrome.writeRequest"
        - "gpii.chrome.writeReceipt"
    */

    fluid.defaults("gpii.chrome.websocket", {
        gradeNames: ["fluid.component"],
        connection: {
            url: "",
            settings: {}
        },
        members: {
            openRequests: {}
        },
        events: {
            onMessage: null,
            onIncomingRead: null,
            onIncomingReadReceipt: null,
            onIncomingWrite: null,
            onIncomingWriteReceipt: null,
            onReady: null,
            onConnect: null,
            onDisconnect: null,
            onError: null
        },
        // Defines which types of messages may be handled and/or sent
        messageTypes: {
            "readRequest": "gpii.chrome.readRequest",
            "readReceipt": "gpii.chrome.readReceipt",
            "writeRequest": "gpii.chrome.writeRequest",
            "writeReceipt": "gpii.chrome.writeReceipt"
        },
        // an inverse lookup for the messageTypes
        messageTypeInverseMap: {
            expander: {
                funcName: "gpii.chrome.websocket.invertMap",
                args: ["{that}.options.messageTypes"]
            }
        },
        // Defines which message types are handled by which event.
        // Message types that aren't defined here are ignored.
        messageHandlingMap: {
            readRequest: "onIncomingRead",
            readReceipt: "onIncomingReadReceipt",
            writeRequest: "onIncomingWrite",
            writeReceipt: "onIncomingWriteReceipt"
        },
        listeners: {
            "onCreate.connect": "{that}.connect",
            "onMessage.filterMessages": {
                listener: "gpii.chrome.websocket.handleIncoming",
                args: ["{that}", "{arguments}.0"]
            },
            "onIncomingRead.handle": {
                listener: "{that}.handleMessage",
                args: ["{that}.options.messageTypes.readReceipt", "{arguments}.0", "{that}.handleRead"]
            },
            "onIncomingReadReceipt.handle": "{that}.handleReceipt",
            "onIncomingWrite.handle": {
                listener: "{that}.handleMessage",
                args: ["{that}.options.messageTypes.writeReceipt", "{arguments}.0", "{that}.handleWrite"]
            },
            "onIncomingWriteReceipt.handle": "{that}.handleReceipt"
        },
        invokers: {
            connect: {
                funcName: "gpii.chrome.websocket.connect",
                args: ["{that}", "{that}.options.connection.url", "{that}.options.connection.protocols", "{that}.options.connection.settings"]
            },
            read: {
                funcName: "gpii.chrome.websocket.postRequest",
                args: ["{that}", "{that}.options.messageTypes.readRequest", "{arguments}.0"]
            },
            write: {
                funcName: "gpii.chrome.websocket.postRequest",
                args: ["{that}", "{that}.options.messageTypes.writeRequest", "{arguments}.0"]
            },
            postReceipt: {
                funcName: "gpii.chrome.websocket.postReceipt",
                args: ["{that}", "{arguments}.0", "{arguments}.1", "{arguments}.2", "{arguments}.3"]
            },
            rejectMessage: {
                funcName: "gpii.chrome.websocket.requestNotAccepted",
                args: ["{that}", "{arguments}.0", "{arguments}.1"]
            },
            handleMessage: {
                funcName: "gpii.chrome.websocket.handleMessage",
                args: ["{that}", "{arguments}.0", "{arguments}.1", "{arguments}.2"]
            },
            handleReceipt: {
                funcName: "gpii.chrome.websocket.handleReceipt",
                args: ["{that}", "{arguments}.0"]
            },
            // handleRead and handleWrite must be implemented by an integrator. They will be called by the handleMessage
            // flow for handling read and write requests. They may return a promise to indicate if the task has
            // completed successfully or not. If a promise isn't returned all responses will be treated as a success.
            handleRead: "fluid.notImplemented",
            handleWrite: "fluid.notImplemented"
        }
    });

    /**
     * Reverses a mapping object, swapping the values (rhs) and props (lhs). The original is preserved.
     * {"a": "b"} -> {"b": "a"}
     *
     * @param {Object} map - the mapping object to invert
     *
     * @return {Object} - a new inverted map will be returned
     */
    gpii.chrome.websocket.invertMap = function (map) {
        var inverted = {};
        fluid.each(map, function (value, prop) {
            inverted[value] = prop;
        });
        return inverted;
    };

    /**
     * An object which allows two way communication with other pages.
     * See: https://developer.chrome.com/apps/runtime#type-Port
     *
     * @typedef {Object} Port
     */

    /**
     * Creates a connection and returns a port.
     *
     * @param {Object} options - Options to pass to the port connection. For example a `name` can be passed along to
     *                           the connection listener.
     *                           see: https://developer.chrome.com/extensions/runtime#method-connect
     *
     * @return {Port} - the chrome port connection
     */
    gpii.chrome.websocket.connect = function (that, url, protocols, options) {
        that.connection = new WebSocket(url, protocols);
        that.connection.addEventListener("close", that.events.onDisconnect.fire);
        that.connection.addEventListener("error", that.events.onError.fire);
        that.connection.addEventListener("message", function (request) {
            console.log("message received", request);
            that.events.onMessage.fire(JSON.parse(request.data));
        });

        that.connection.addEventListener("open", function (response) {
            console.log("connection opened");
            try {
                console.log("send options:", options);
                that.connection.send(JSON.stringify(options));
                that.events.onConnect.fire(response);
            } catch (error) {
                console.log("error:", error);
                that.events.onError.fire(error);
            }

        });

        return that.connection;
    };

    /**
     * Posts a request over the {Port} connection. The content of the message must be provided in the `payload`
     * argument. A promise is returned and will be resolved/rejected upon receiving a receipt from the other end. An
     * `id` is sent with the message and should be used as the `id` in a receipt to identify which message the receipt
     * is for.
     *
     * @param {Component} that - an instance of `gpii.chrome.websocket`
     * @param {String} type - identifies the type of message for listeners on the other end.
     * @param {Object} payload - the content of the message
     *
     * @return {Promise} - a promise that is resolved/rejected upon receipt from the other end.
     */
    gpii.chrome.websocket.postRequest = function (that, type, payload) {
        var promise = fluid.promise();
        var id = type + "-" + fluid.allocateGuid();
        that.openRequests[id] = promise;

        try {
            var postMessage = {
                id: id,
                type: type,
                payload: payload
            };

            that.connection.send(JSON.stringify(postMessage));
        } catch (error) {
            delete that.openRequests[id];
            promise.reject(error);
        }

        return promise;
    };

    /**
     * Posts the receipt over the {Port} connection to reply to a previously received message. Content of the receipt
     * may be provided in the `payload` argument.
     *
     * @param {Component} that - an instance of `gpii.chrome.websocket`
     * @param {String} type - identifies the type of message for listeners on the other end.
     * @param {String} id - must match a previously received message.
     * @param {Object} payload - the content to return
     * @param {Object} error - an error object to return if the previous message handling failed.
     */
    gpii.chrome.websocket.postReceipt = function (that, type, id, payload, error) {
        var toPost = {
            id: id,
            type: type,
            payload: payload
        };

        if (error) {
            toPost.error = error;
        }

        that.connection.send(JSON.stringify(toPost));
    };

    /**
     * Can be used to replace the listener for the onIncomingRead and onIncomingWrite events if those operations aren't
     * supported.
     *
     * @param {Component} that - an instance of `gpii.chrome.websocket`
     * @param {String} type - identifies the type of message for listeners on the other end.
     * @param {Object} data - the incoming data from the message.
     */
    gpii.chrome.websocket.requestNotAccepted = function (that, type, data) {
        that.postReceipt(type, data.id, null, {message: "Request of type: " + data.type + " are not accepted."});
    };

    /**
     * Directs the incoming message to the appropriate event:
     * `onIncomingRead`, `onIncomingReadReceipt`, `onIncomingWrite`, `onIncomingWriteReceipt`
     *
     * @param {Component} that - an instance of `gpii.chrome.websocket`
     * @param {Object} data - the data to handle from the incoming port message
     */
    gpii.chrome.websocket.handleIncoming = function (that, request) {
        var data = JSON.parse(request.data);
        console.log("data:", data);
        var messageType = that.options.messageTypeInverseMap[data.type];
        var eventName = that.options.messageHandlingMap[messageType];

        if (eventName) {
            that.events[eventName].fire(data);
        }
    };

    /**
     * A function to handle incoming request messages. The function will be passed in the message `data` as its only
     * argument. The `data` in a well formed request will typically take the form of
     * {
     *     type: {String} // the message type e.g. "gpii.chrome.readRequest"
     *     id: {String} // a unique ID. This will be returned in the receipt.
     *     payload: {Object} // the content of the request. May not be included in all requests
     * }
     *
     * The MessageHandler function should return a promise, which will be used to indicate if the message request was
     * accepted or rejected. If a promise isn't retuned, all requests will be treated as accepted.
     *
     * @typedef {Function} MessageHandler
     */

    /**
     * Handles an incoming message. It will call the `handleMessageImpl` invoker; which needs to be set by an
     * integrator. The result or promise returned by `handleMessageImpl` is used to determine if a receipt should be
     * sent with or without an error and with what payload.
     *
     * @param {Component} that - an instance of `gpii.chrome.websocket`
     * @param {String} type - identifies the type of message for listeners on the other end.
     * @param {Object} data - the incoming data from the message.
     * @param {MessageHandler} handleFn - a function to handle the message
     *
     * @return {Promise} - a promise that is resolved/rejected based on the result of `handleFn` execution
     */
    gpii.chrome.websocket.handleMessage = function (that, type, data, handleFn) {
        var promise = fluid.promise();

        promise.then(function (value) {
            that.postReceipt(type, data.id, value);
        }, function (reason) {
            // this should be a rejected receipt
            that.postReceipt(type, data.id, data.payload, reason);
        });

        var handlePromise = handleFn(data);
        handlePromise = fluid.toPromise(handlePromise);
        fluid.promise.follow(handlePromise, promise);

        return promise;
    };

    /**
     * Handles the receipt of a posted message. Based on the `id` in the receipt, the promise related to the originally
     * sent message will be removed from the `openRequests` object and resolved/rejected as needed.
     *
     * @param {Component} that - an instance of `gpii.chrome.websocket`
     * @param {Object} receipt - the data from the receipt
     */
    gpii.chrome.websocket.handleReceipt = function (that, receipt) {
        var promise = that.openRequests[receipt.id];

        if (promise) {
            delete that.openRequests[receipt.id];

            if (receipt.error) {
                promise.reject(receipt.error);
            } else {
                promise.resolve(receipt.payload);
            }
        }
    };


    /***************************
     * port binding data store *
     ***************************/

    fluid.defaults("gpii.chrome.websocket.store", {
        gradeNames: ["fluid.dataSource", "gpii.chrome.websocket"],
        components: {
            encoding: {
                type: "fluid.dataSource.encoding.model"
            }
        },
        listeners: {
            "onRead.impl": "{that}.read",
            "onIncomingRead.handle": {
                listener: "{that}.rejectMessage",
                args: ["{that}.options.messageTypes.readReceipt", "{arguments}.0"]
            },
            "onIncomingWrite.handle": {
                listener: "{that}.rejectMessage",
                args: ["{that}.options.messageTypes.writeReceipt", "{arguments}.0"]
            }
        },
        invokers: {
            handleRead: "fluid.identity",
            handleWrite: "fluid.identity"
        }
    });

    fluid.defaults("gpii.chrome.websocket.store.writable", {
        gradeNames: ["fluid.prefs.tempStore.writable"],
        listeners: {
            "onWrite.impl": {
                listener: "{that}.write"
            }
        }
    });

    fluid.makeGradeLinkage("gpii.chrome.websocket.store.linkage", ["fluid.dataSource.writable", "gpii.chrome.websocket.store"], "gpii.chrome.websocket.store.writable");

})(fluid);
