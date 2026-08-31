#!/usr/bin/env python3
"""通过密码 SSH 到腾讯云服务器执行命令，输出 stdout/stderr/exit code。"""
import sys
import paramiko

HOST = "43.161.198.188"
PORT = 22
USER = "root"
PASSWORD = "Wo99wangbuliao!"

def run(cmd: str):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, port=PORT, username=USER, password=PASSWORD,
                   timeout=40, banner_timeout=40, auth_timeout=40)
    stdin, stdout, stderr = client.exec_command(cmd, timeout=60)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    rc = stdout.channel.recv_exit_status()
    client.close()
    return out, err, rc

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "echo no-cmd"
    out, err, rc = run(cmd)
    print("=== EXIT CODE:", rc, "===")
    if out:
        print("=== STDOUT ===")
        print(out.rstrip("\n"))
    if err:
        print("=== STDERR ===")
        print(err.rstrip("\n"))
