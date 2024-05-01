(() => {
    'use strict';
    let https_proxy_url = "https://localhost";
    let wss_proxy_url = "wss://localhost";

    function prosessing_url(url, webSocket=false) {
        if (webSocket) {
            let new_url = new URL(url);
            new_url.protocol = "https";
            return wss_proxy_url + textToBase64(new_url.href);
        }
        return https_proxy_url + textToBase64(url);
    }
  
    setInterval(async function () {
        let list_element = [];
        let list_script = document.querySelectorAll('script');
        let list_image = document.querySelectorAll('img');
        list_element.push(...list_script);
        list_element.push(...list_image);
        for (let i of list_element) {
            if (!i.src) continue;
            if (i.__proxyed) continue;
            if (i.zsrc) continue;
            i.zsrc = true;
            let prnode = i.parentNode;
            i.addEventListener('error', async function (event) {
                let newScript = document.createElement('script');
                for (let attr of i.attributes) {
                    newScript.setAttribute(attr.name, attr.value);
                }
                newScript.__proxyed = true;
                newScript.src = prosessing_url(i.src);
                prnode.replaceChild(newScript, i);
            })
        }
    }, 1);


    const rFetch = window.fetch.bind(window);
    const rSendBeacon = navigator.sendBeacon.bind(navigator);
    const rXMLHttpRequest = window.XMLHttpRequest.bind(window);
    const rWebSocket = window.WebSocket.bind(window);

    function textToBase64(text) {
        let bytes = new TextEncoder().encode(text);
        const binString = String.fromCodePoint(...bytes);
        return btoa(binString);
    }

    window.fetch = async function (input, init) {
        try {
            return await rFetch(input, init);
        } catch (e) {
            let rproxy = await rFetch(prosessing_url(input), init);
            if (rproxy.status == 502) {
                throw e;
            }
            return rproxy;
        }
    }


    navigator.sendBeacon = function (input, body_in) {
        if (!window.hasOwnProperty("fetch")) { return rSendBeacon(input, body_in) };
        let types = ["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"];
        var check_t = !body_in || !(
            body_in instanceof Blob && !types.find(
                (metadata) => {
                    return body_in.type.startsWith(metadata)
                })
        );
        let ops = {
            method: 'POST',
            body: body_in,
            keepalive: false,
            credentials: check_t ? "same-origin" : "include",
            mode: check_t ? "no-cors" : "cors"
        };
        if (ops.body = body_in || 0 === body_in ? body_in : "", ops.body instanceof Blob) {
            if (ops.body.size > 65536) return false;
        } else if (ops.body && "function" == typeof ops.body.toString && ops.body.toString().length > 65536) return false;
        try {
            window.fetch(input, ops);
        } catch (e) { }
        return true;
    }

    let list_envent = [
        "abort",
        "error",
        "load",
        "loadend",
        "loadstart",
        "progress",
        "readystatechange",
        "timeout"
    ];

    window.XMLHttpRequest = function () {
        let ev = {};
        let cache = {};
        let isasync = false;
        let proxy_headers = {};
        let isproxy = false;
        let proxyXMLHttpRequest = new rXMLHttpRequest();

        proxyXMLHttpRequest.open = function (method, url, async, username, password) {
            cache["open"] = {
                "method": method,
                "url": url,
                "username": username,
                "password": password
            }
            if (async === false) {
                isasync = false;
            }
            proxyXMLHttpRequest.__proto__.open.call(proxyXMLHttpRequest, method, url, async, username, password);
        }

        function new_request() {
            isproxy = true;
            let new_url = prosessing_url(cache["open"]["url"]);
            proxyXMLHttpRequest.__proto__.open.call(proxyXMLHttpRequest, cache["open"]["method"], new_url, isasync, cache["open"]["username"], cache["open"]["password"]);
            for (let key in proxy_headers) {
                proxyXMLHttpRequest.setRequestHeader(key, proxy_headers[key]);
            }
            proxyXMLHttpRequest.__proto__.send.call(proxyXMLHttpRequest, cache["send"]);
        }


        for (let z of list_envent) {
            let i = "on" + z;
            Object.defineProperty(proxyXMLHttpRequest, i, {
                get: function () {
                    return ev[i] || null;
                },
                set: function (n) {
                    ev[i] = n;
                }
            })
            proxyXMLHttpRequest.addEventListener(z, (event) => {
                if (isasync && proxyXMLHttpRequest.readyState == 4 && proxyXMLHttpRequest.status == 0) {
                    new_request();
                    return;
                }

                if (isproxy && proxyXMLHttpRequest.readyState == 1) return;
                if (isproxy && proxyXMLHttpRequest.readyState == 4 && proxyXMLHttpRequest.status != 0) isproxy = false;
                if (isproxy && proxyXMLHttpRequest.status == 502) {
                    proxyXMLHttpRequest.abort();
                    isproxy = false;
                    return false;
                }
                if (ev[z]) {
                    for (let handler of ev[z]) {
                        (async () => { handler(event) })();
                    }
                }
                if (ev[i]) {
                    (async () => { ev[i](event) })();
                }
            });
        }
        let rOpen = proxyXMLHttpRequest.open.bind(proxyXMLHttpRequest);
        proxyXMLHttpRequest.open = function (method, url, async, username, password) {
            isasync = async;
            isproxy = false;
            rOpen(method, url, async, username, password);

        }
        proxyXMLHttpRequest.addEventListener = function (type, handler) {
            if (ev[type]) {
                ev[type].push(handler);
            } else {
                ev[type] = [handler];
            }
        }
        proxyXMLHttpRequest.setRequestHeader = function (key, value) {
            proxy_headers[key] = value
            proxyXMLHttpRequest.__proto__.setRequestHeader.call(proxyXMLHttpRequest, key, value);
        }
        proxyXMLHttpRequest.send = function (body) {
            cache["send"] = body
            try {
                proxyXMLHttpRequest.__proto__.send.call(proxyXMLHttpRequest, body);
            } catch (e) {
                new_request();
                if (proxyXMLHttpRequest.status == 502) {
                    throw e;
                }
            }
        }
        return proxyXMLHttpRequest;
    }
    let ws_list_envent = [
        "close",
        "error",
        "message",
        "open"
    ]
    function WebSocket(url, protocols) {
        let ev = {};
        let isproxy = false;
        let cache_err = null;
        let proxyWebSocket = null;
        let rproxyWebSocket = new rWebSocket(url, protocols);
        function add_evetnt(ws) {
            for (let z of ws_list_envent) {
                let i = "on" + z;
                Object.defineProperty(ws, i, {
                    get: function () {
                        return ev[i] || null;
                    },
                    set: function (n) {
                        ev[i] = n;
                    }
                })
                ws.addEventListener(z, (event) => {
                    if (event.type == "error" && !isproxy) {
                        return;
                    }
                    if (event.type == "error" && isproxy && cache_err != null) {
                        event = cache_err;
                    }
                    if (event.type == "close" && !isproxy && event.code == 1006) {
                        let pxbinaryType = rproxyWebSocket.binaryType;
                        proxyWebSocket = new rWebSocket(prosessing_url(url, true), protocols);
                        add_evetnt(proxyWebSocket);
                        proxyWebSocket.binaryType = pxbinaryType;
                        isproxy = true;
                        cache_err = event;
                        return
                    }
                    if (ev[z]) {
                        for (let handler of ev[z]) {
                            (async () => { handler(event) })();
                        }
                    }
                    if (ev[i]) {
                        (async () => { ev[i](event) })();
                    }
                });
            }
        }
        add_evetnt(rproxyWebSocket);
        rproxyWebSocket.addEventListener = function (type, handler) {
            if (ev[type]) {
                ev[type].push(handler);
            } else {
                ev[type] = [handler];
            }
        }
        rproxyWebSocket.send = function (body) {
            if (proxyWebSocket == null) {
                return rproxyWebSocket.__proto__.send.call(rproxyWebSocket, body);
            }
            proxyWebSocket.send(body);
        }
        rproxyWebSocket.close = function (code, reason) {
            if (proxyWebSocket == null) {
                return rproxyWebSocket.__proto__.close.call(rproxyWebSocket, code, reason);
            }
            proxyWebSocket.code(code, reason);
        }
        return rproxyWebSocket;
    }
    window.WebSocket = WebSocket;
})();
