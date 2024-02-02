mod decrypt;
use std::convert::Infallible;
use std::net::ToSocketAddrs as _;
use std::str::FromStr as _;
use http_body_util::combinators::BoxBody;
use hyper::body::Bytes;
use hyper::header::HeaderValue;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode, Uri};
use hyper_tls::HttpsConnector;
use hyper_util::client::legacy;
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto;
use tokio::net::TcpListener;
use decrypt::decrypt;

fn remove_leading_slash(input: &str) -> &str {
    if let Some(stripped) = input.strip_prefix('/') {
        stripped
    } else {
        input
    }
}

async fn hello(
    mut req: Request<hyper::body::Incoming>,
) -> Result<Response<BoxBody<Bytes, hyper::Error>>, Infallible> {
    let on_req_upgrade = hyper::upgrade::on(&mut req);
    let connector = HttpsConnector::new();
    let path_req = remove_leading_slash(req.uri().path());
    let der_rs = decrypt(path_req);
    if der_rs.is_err() {
        return Ok(Response::builder().status(StatusCode::GATEWAY_TIMEOUT).body(BoxBody::default()).unwrap());
    }
    let dec = der_rs.unwrap();
    let proxy_url_raw = Uri::from_str(&dec);
    if proxy_url_raw.is_err() {
        return Ok(Response::builder().status(StatusCode::GATEWAY_TIMEOUT).body(BoxBody::default()).unwrap());
    }
    let proxy_url = proxy_url_raw.unwrap();
    if proxy_url.scheme_str() != Some("https") {
        return Ok(Response::builder().status(StatusCode::GATEWAY_TIMEOUT).body(BoxBody::default()).unwrap());
    } else if proxy_url.port().is_some() {
        return Ok(Response::builder().status(StatusCode::GATEWAY_TIMEOUT).body(BoxBody::default()).unwrap());
    }
    *req.uri_mut() = Uri::from_str(&dec).unwrap();
    req.headers_mut().remove("host");
    req.headers_mut().append("host", HeaderValue::from_str(proxy_url.host().unwrap()).unwrap());
    let headers = req.headers_mut();
    for (key, _i) in headers.clone().into_iter() {
        let k_name = key.unwrap();
        if k_name.to_string().starts_with("cf-") || k_name.to_string() == "cdn-loop" {
            req.headers_mut().remove(k_name);
        }
    }
    let sender = legacy::Builder::new(TokioExecutor::new()).build(connector);
    let resp_raw = sender.request(req).await;
    if resp_raw.is_err() {
        println!("{}", resp_raw.unwrap_err());
        return Ok(Response::builder().status(StatusCode::GATEWAY_TIMEOUT).body(BoxBody::default()).unwrap());
    }
    let mut resp = resp_raw.unwrap();
    let on_resp_upgrade = hyper::upgrade::on(&mut resp).await;
    if resp.status() == StatusCode::SWITCHING_PROTOCOLS {
        tokio::spawn(async move {
            let mut req_up = TokioIo::new(on_req_upgrade.await.unwrap());
            let mut resp_up = TokioIo::new(on_resp_upgrade.unwrap());
            tokio::io::copy_bidirectional(&mut req_up, &mut resp_up)
                .await
                .unwrap();
        });
    }
    let (parts, body) = resp.into_parts();
    let resp = Response::from_parts(parts, BoxBody::new(body));
    Ok(resp)
}

#[tokio::main]
pub async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let addrs = tokio::fs::read_to_string("./config").await.unwrap();
    let addrs_iter = addrs.to_socket_addrs();
    if addrs_iter.is_err() {
        panic!("{}", addrs_iter.unwrap_err());
    }
    let addr = addrs_iter.unwrap().next().unwrap();
    let listener = TcpListener::bind(addr).await?;
    println!("Listening on http://{}", addr);
    loop {
        let (tcp, _) = listener.accept().await?;
        let io = TokioIo::new(tcp);
        tokio::task::spawn(async move {
            if let Err(err) = auto::Builder::new(TokioExecutor::new())
                .serve_connection(io, service_fn(hello))
                .await
            {
                println!("Error serving connection: {:?}", err);
            }
        });
    }
}
