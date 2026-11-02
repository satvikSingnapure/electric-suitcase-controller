
package com.example.electricsuitcase

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.example.electricsuitcase.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val suitcaseBluetoothManager = SuitcaseBluetoothManager()
    private val bluetoothAdapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
    private val discoveredDevices = mutableListOf<BluetoothDevice>()

    private val enableBluetoothLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (bluetoothAdapter?.isEnabled == true) {
            Toast.makeText(this, "Bluetooth enabled", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(this, "Bluetooth was not enabled", Toast.LENGTH_SHORT).show()
        }
    }

    private val bluetoothReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                BluetoothDevice.ACTION_FOUND -> {
                    val device: BluetoothDevice? = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
                    device ?: return

                    if (!discoveredDevices.any { it.address == device.address }) {
                        discoveredDevices.add(device)
                    }

                    val name = device.name ?: "Unknown device"
                    Toast.makeText(this@MainActivity, "Found: $name", Toast.LENGTH_SHORT).show()
                }
                BluetoothAdapter.ACTION_DISCOVERY_FINISHED -> {
                    showDevicePicker(discoveredDevices)
                    binding.scanButton.text = "Scan for devices"
                    binding.scanButton.isEnabled = true
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        ensureBluetoothPermissions()
        registerReceiver(bluetoothReceiver, IntentFilter(BluetoothDevice.ACTION_FOUND))
        registerReceiver(bluetoothReceiver, IntentFilter(BluetoothAdapter.ACTION_DISCOVERY_FINISHED))

        binding.pairedButton.setOnClickListener { showDevicePicker(suitcaseBluetoothManager.getPairedDevices()) }
        binding.scanButton.setOnClickListener { startBluetoothScan() }
        binding.disconnectButton.setOnClickListener {
            suitcaseBluetoothManager.disconnect()
            updateStatus("Disconnected")
            Toast.makeText(this, "Disconnected from suitcase", Toast.LENGTH_SHORT).show()
        }

        binding.powerButton.setOnClickListener { togglePower() }
        binding.forwardButton.setOnClickListener { sendCommand("F") }
        binding.backwardButton.setOnClickListener { sendCommand("B") }
        binding.leftButton.setOnClickListener { sendCommand("L") }
        binding.rightButton.setOnClickListener { sendCommand("R") }
        binding.stopButton.setOnClickListener { sendCommand("S") }
        binding.speed1Button.setOnClickListener { sendCommand("V1") }
        binding.speed2Button.setOnClickListener { sendCommand("V2") }
        binding.speed3Button.setOnClickListener { sendCommand("V3") }

        updateStatus("Disconnected")
        binding.powerButton.text = "Turn On"
    }

    private fun ensureBluetoothPermissions() {
        val permissions = mutableListOf<String>()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissions += Manifest.permission.BLUETOOTH_SCAN
            permissions += Manifest.permission.BLUETOOTH_CONNECT
        } else {
            permissions += Manifest.permission.ACCESS_FINE_LOCATION
        }

        val missingPermissions = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (missingPermissions.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missingPermissions.toTypedArray(), 1001)
        }

        if (bluetoothAdapter != null && !bluetoothAdapter.isEnabled) {
            val enableIntent = Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE)
            enableBluetoothLauncher.launch(enableIntent)
        }
    }

    private fun startBluetoothScan() {
        if (!suitcaseBluetoothManager.isBluetoothEnabled()) {
            Toast.makeText(this, "Please enable Bluetooth first", Toast.LENGTH_SHORT).show()
            return
        }

        discoveredDevices.clear()
        binding.scanButton.text = "Scanning..."
        binding.scanButton.isEnabled = false

        if (bluetoothAdapter?.isDiscovering == true) {
            bluetoothAdapter.cancelDiscovery()
        }

        val started = bluetoothAdapter?.startDiscovery() == true
        if (!started) {
            binding.scanButton.text = "Scan for devices"
            binding.scanButton.isEnabled = true
            Toast.makeText(this, "Could not start Bluetooth scan", Toast.LENGTH_SHORT).show()
        }
    }

    private fun showDevicePicker(devices: List<BluetoothDevice>) {
        if (devices.isEmpty()) {
            Toast.makeText(this, "No Bluetooth devices found", Toast.LENGTH_SHORT).show()
            return
        }

        val names = devices.map { it.name ?: "Unnamed device" }.toTypedArray()

        AlertDialog.Builder(this)
            .setTitle("Select suitcase")
            .setItems(names) { _, index ->
                val selectedDevice = devices[index]
                connectToDevice(selectedDevice)
            }
            .show()
    }

    private fun connectToDevice(device: BluetoothDevice) {
        val success = suitcaseBluetoothManager.connectToDevice(device)
        if (success) {
            updateStatus("Connected: ${device.name ?: "Suitcase"}")
            Toast.makeText(this, "Connected to ${device.name ?: "suitcase"}", Toast.LENGTH_SHORT).show()
        } else {
            updateStatus("Connection failed")
            Toast.makeText(this, "Could not connect to suitcase", Toast.LENGTH_LONG).show()
        }
    }

    private fun sendCommand(command: String) {
        if (!suitcaseBluetoothManager.isConnected()) {
            Toast.makeText(this, "Connect to your suitcase first", Toast.LENGTH_SHORT).show()
            return
        }

        val success = suitcaseBluetoothManager.sendCommand(command)
        if (!success) {
            updateStatus("Command failed")
            Toast.makeText(this, "Could not send command", Toast.LENGTH_SHORT).show()
        }
    }

    private fun togglePower() {
        if (!suitcaseBluetoothManager.isConnected()) {
            Toast.makeText(this, "Connect to your suitcase first", Toast.LENGTH_SHORT).show()
            return
        }

        val nextState = binding.powerButton.text == "Turn Off"
        val command = if (nextState) "P0" else "P1"
        suitcaseBluetoothManager.sendCommand(command)

        binding.powerButton.text = if (nextState) "Turn On" else "Turn Off"
        updateStatus(if (nextState) "Suitcase powered off" else "Suitcase powered on")
    }

    private fun updateStatus(message: String) {
        binding.statusText.text = message
    }

    override fun onDestroy() {
        unregisterReceiver(bluetoothReceiver)
        suitcaseBluetoothManager.disconnect()
        super.onDestroy()
    }
}
