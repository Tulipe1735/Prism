// WSL loopback endpoint -> an owned Windows loopback Chrome endpoint via stdio.
const net=require('net'),cp=require('child_process');
const executable='/mnt/c/Program Files/nodejs/node.exe',script=process.argv[2],children=new Set();
const server=net.createServer(socket=>{const child=cp.spawn(executable,[script,'relay'],{stdio:['pipe','pipe','ignore']});children.add(child);socket.pipe(child.stdin);child.stdout.pipe(socket);child.stdin.on('error',()=>socket.destroy());child.on('error',()=>socket.destroy());child.on('exit',()=>{children.delete(child);socket.destroy();});socket.on('close',()=>child.kill());socket.on('error',()=>child.kill());});
server.listen(9333,'127.0.0.1',()=>console.log(JSON.stringify({linux_endpoint:'http://127.0.0.1:9333',windows_loopback_port:19334})));
process.on('SIGTERM',()=>{for(const child of children)child.kill();server.close(()=>process.exit());});
