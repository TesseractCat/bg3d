use actix_web::{get, post, web, App, HttpRequest, HttpResponse, HttpServer, Responder, Error};
use actix_web::http::header::{ContentDisposition, DispositionType};
use actix_files as fs;

#[get("/{filename:.*}")]
async fn index(req: HttpRequest) -> Result<fs::NamedFile, Error> {
    let mut path: std::path::PathBuf = req.match_info().query("filename").parse().unwrap();
    path = std::path::Path::new("static/").join(path);
    println!("{:?}", path);
    let file = fs::NamedFile::open(path)?;
    Ok(file)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    HttpServer::new(|| {
        App::new()
            .service(fs::Files::new("/", "./static"))
    })
    .bind("127.0.0.1:8000")?
    .run()
    .await
}
