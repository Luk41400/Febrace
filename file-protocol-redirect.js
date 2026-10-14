const { hostname, pathname, search, hash, protocol } = window.location;
if (hostname === "luk41400.github.io" && (pathname === "/Febrace" || pathname.startsWith("/Febrace/"))) {
  const destinationPath = pathname.slice("/Febrace".length) || "/";
  window.location.replace(`https://febrace.vercel.app${destinationPath}${search}${hash}`);
} else if (protocol === "file:") {
  window.location.replace("http://localhost:3000/");
}
