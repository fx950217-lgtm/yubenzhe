import socket, time

IP='45.77.247.167'
pkt = bytes([0x03,0x00,0x00,0x13,0x0e,0xe0,0x00,0x00,0x00,0x00,0x00,
             0x01,0x00,0x08,0x00,0x03,0x00,0x00,0x00])

print("等待 Windows RDP 服务就绪（最多 5 分钟）...")
print()
ok = False
for n in range(10):
    try:
        s = socket.create_connection((IP, 3389), timeout=10)
        s.sendall(pkt)
        s.settimeout(12)
        data = s.recv(2048)
        s.close()
        if data and data[0] == 0x03:
            print(f"[{n+1}/10] RDP 就绪！应答 {len(data)} 字节: {data[:12].hex()}")
            ok = True
            break
        else:
            print(f"[{n+1}/10] 已连接但无应答（仍在初始化）")
    except socket.timeout:
        print(f"[{n+1}/10] 无应答（仍在初始化）")
    except Exception as e:
        print(f"[{n+1}/10] {type(e).__name__}")
    time.sleep(28)

print()
print("结论:", "RDP 服务就绪，可以连接" if ok else "仍需等待或检查")
