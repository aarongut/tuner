from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler 
import ssl

httpd = ThreadingHTTPServer(('', 8443), SimpleHTTPRequestHandler)
ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ssl_context.load_cert_chain('/Users/amgutier/certs/fullchain.pem', keyfile='/Users/amgutier/certs/privkey.pem')
httpd.socket = ssl_context.wrap_socket(httpd.socket, server_side=True)
httpd.serve_forever()
