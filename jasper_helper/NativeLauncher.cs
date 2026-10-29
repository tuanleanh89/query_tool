using System;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Diagnostics;

namespace JasperHelperHost
{
    class Program
    {
        static void Main(string[] args)
        {
            try
            {
                string dir = AppDomain.CurrentDomain.BaseDirectory;
                string vbsPath = Path.Combine(dir, "run_hidden.vbs");
                string batPath = Path.Combine(dir, "start.bat");

                bool isRunning = IsPortListening("127.0.0.1", 8080);
                if (!isRunning)
                {
                    if (File.Exists(vbsPath))
                    {
                        var psi = new ProcessStartInfo
                        {
                            FileName = "wscript.exe",
                            Arguments = "\"" + vbsPath + "\"",
                            WorkingDirectory = dir,
                            WindowStyle = ProcessWindowStyle.Hidden,
                            CreateNoWindow = true,
                            UseShellExecute = true
                        };
                        Process.Start(psi);
                    }
                    else if (File.Exists(batPath))
                    {
                        var psi = new ProcessStartInfo
                        {
                            FileName = "cmd.exe",
                            Arguments = "/c \"" + batPath + "\"",
                            WorkingDirectory = dir,
                            WindowStyle = ProcessWindowStyle.Hidden,
                            CreateNoWindow = true,
                            UseShellExecute = false
                        };
                        Process.Start(psi);
                    }
                }

                // If launched by Chrome/Firefox Native Messaging via stdio
                if (Console.IsInputRedirected)
                {
                    // Read incoming message length (4 bytes)
                    Stream stdin = Console.OpenStandardInput();
                    byte[] lenBytes = new byte[4];
                    int read = stdin.Read(lenBytes, 0, 4);
                    if (read == 4)
                    {
                        int msgLen = BitConverter.ToInt32(lenBytes, 0);
                        if (msgLen > 0 && msgLen < 1024 * 1024)
                        {
                            byte[] msgBuffer = new byte[msgLen];
                            stdin.Read(msgBuffer, 0, msgLen);
                        }
                    }

                    // Send response message back
                    string jsonResponse = "{\"status\":\"ok\",\"started\":" + (!isRunning ? "true" : "false") + ",\"port\":8080}";
                    byte[] resBytes = Encoding.UTF8.GetBytes(jsonResponse);
                    byte[] outLen = BitConverter.GetBytes(resBytes.Length);

                    Stream stdout = Console.OpenStandardOutput();
                    stdout.Write(outLen, 0, 4);
                    stdout.Write(resBytes, 0, resBytes.Length);
                    stdout.Flush();
                }
            }
            catch (Exception ex)
            {
                try
                {
                    if (Console.IsOutputRedirected)
                    {
                        string errJson = "{\"status\":\"error\",\"message\":\"" + ex.Message.Replace("\"", "\\\"") + "\"}";
                        byte[] errBytes = Encoding.UTF8.GetBytes(errJson);
                        byte[] outLen = BitConverter.GetBytes(errBytes.Length);
                        Stream stdout = Console.OpenStandardOutput();
                        stdout.Write(outLen, 0, 4);
                        stdout.Write(errBytes, 0, errBytes.Length);
                        stdout.Flush();
                    }
                }
                catch { }
            }
        }

        static bool IsPortListening(string host, int port)
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var result = client.BeginConnect(host, port, null, null);
                    bool success = result.AsyncWaitHandle.WaitOne(TimeSpan.FromMilliseconds(400));
                    if (!success) return false;
                    client.EndConnect(result);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }
    }
}
