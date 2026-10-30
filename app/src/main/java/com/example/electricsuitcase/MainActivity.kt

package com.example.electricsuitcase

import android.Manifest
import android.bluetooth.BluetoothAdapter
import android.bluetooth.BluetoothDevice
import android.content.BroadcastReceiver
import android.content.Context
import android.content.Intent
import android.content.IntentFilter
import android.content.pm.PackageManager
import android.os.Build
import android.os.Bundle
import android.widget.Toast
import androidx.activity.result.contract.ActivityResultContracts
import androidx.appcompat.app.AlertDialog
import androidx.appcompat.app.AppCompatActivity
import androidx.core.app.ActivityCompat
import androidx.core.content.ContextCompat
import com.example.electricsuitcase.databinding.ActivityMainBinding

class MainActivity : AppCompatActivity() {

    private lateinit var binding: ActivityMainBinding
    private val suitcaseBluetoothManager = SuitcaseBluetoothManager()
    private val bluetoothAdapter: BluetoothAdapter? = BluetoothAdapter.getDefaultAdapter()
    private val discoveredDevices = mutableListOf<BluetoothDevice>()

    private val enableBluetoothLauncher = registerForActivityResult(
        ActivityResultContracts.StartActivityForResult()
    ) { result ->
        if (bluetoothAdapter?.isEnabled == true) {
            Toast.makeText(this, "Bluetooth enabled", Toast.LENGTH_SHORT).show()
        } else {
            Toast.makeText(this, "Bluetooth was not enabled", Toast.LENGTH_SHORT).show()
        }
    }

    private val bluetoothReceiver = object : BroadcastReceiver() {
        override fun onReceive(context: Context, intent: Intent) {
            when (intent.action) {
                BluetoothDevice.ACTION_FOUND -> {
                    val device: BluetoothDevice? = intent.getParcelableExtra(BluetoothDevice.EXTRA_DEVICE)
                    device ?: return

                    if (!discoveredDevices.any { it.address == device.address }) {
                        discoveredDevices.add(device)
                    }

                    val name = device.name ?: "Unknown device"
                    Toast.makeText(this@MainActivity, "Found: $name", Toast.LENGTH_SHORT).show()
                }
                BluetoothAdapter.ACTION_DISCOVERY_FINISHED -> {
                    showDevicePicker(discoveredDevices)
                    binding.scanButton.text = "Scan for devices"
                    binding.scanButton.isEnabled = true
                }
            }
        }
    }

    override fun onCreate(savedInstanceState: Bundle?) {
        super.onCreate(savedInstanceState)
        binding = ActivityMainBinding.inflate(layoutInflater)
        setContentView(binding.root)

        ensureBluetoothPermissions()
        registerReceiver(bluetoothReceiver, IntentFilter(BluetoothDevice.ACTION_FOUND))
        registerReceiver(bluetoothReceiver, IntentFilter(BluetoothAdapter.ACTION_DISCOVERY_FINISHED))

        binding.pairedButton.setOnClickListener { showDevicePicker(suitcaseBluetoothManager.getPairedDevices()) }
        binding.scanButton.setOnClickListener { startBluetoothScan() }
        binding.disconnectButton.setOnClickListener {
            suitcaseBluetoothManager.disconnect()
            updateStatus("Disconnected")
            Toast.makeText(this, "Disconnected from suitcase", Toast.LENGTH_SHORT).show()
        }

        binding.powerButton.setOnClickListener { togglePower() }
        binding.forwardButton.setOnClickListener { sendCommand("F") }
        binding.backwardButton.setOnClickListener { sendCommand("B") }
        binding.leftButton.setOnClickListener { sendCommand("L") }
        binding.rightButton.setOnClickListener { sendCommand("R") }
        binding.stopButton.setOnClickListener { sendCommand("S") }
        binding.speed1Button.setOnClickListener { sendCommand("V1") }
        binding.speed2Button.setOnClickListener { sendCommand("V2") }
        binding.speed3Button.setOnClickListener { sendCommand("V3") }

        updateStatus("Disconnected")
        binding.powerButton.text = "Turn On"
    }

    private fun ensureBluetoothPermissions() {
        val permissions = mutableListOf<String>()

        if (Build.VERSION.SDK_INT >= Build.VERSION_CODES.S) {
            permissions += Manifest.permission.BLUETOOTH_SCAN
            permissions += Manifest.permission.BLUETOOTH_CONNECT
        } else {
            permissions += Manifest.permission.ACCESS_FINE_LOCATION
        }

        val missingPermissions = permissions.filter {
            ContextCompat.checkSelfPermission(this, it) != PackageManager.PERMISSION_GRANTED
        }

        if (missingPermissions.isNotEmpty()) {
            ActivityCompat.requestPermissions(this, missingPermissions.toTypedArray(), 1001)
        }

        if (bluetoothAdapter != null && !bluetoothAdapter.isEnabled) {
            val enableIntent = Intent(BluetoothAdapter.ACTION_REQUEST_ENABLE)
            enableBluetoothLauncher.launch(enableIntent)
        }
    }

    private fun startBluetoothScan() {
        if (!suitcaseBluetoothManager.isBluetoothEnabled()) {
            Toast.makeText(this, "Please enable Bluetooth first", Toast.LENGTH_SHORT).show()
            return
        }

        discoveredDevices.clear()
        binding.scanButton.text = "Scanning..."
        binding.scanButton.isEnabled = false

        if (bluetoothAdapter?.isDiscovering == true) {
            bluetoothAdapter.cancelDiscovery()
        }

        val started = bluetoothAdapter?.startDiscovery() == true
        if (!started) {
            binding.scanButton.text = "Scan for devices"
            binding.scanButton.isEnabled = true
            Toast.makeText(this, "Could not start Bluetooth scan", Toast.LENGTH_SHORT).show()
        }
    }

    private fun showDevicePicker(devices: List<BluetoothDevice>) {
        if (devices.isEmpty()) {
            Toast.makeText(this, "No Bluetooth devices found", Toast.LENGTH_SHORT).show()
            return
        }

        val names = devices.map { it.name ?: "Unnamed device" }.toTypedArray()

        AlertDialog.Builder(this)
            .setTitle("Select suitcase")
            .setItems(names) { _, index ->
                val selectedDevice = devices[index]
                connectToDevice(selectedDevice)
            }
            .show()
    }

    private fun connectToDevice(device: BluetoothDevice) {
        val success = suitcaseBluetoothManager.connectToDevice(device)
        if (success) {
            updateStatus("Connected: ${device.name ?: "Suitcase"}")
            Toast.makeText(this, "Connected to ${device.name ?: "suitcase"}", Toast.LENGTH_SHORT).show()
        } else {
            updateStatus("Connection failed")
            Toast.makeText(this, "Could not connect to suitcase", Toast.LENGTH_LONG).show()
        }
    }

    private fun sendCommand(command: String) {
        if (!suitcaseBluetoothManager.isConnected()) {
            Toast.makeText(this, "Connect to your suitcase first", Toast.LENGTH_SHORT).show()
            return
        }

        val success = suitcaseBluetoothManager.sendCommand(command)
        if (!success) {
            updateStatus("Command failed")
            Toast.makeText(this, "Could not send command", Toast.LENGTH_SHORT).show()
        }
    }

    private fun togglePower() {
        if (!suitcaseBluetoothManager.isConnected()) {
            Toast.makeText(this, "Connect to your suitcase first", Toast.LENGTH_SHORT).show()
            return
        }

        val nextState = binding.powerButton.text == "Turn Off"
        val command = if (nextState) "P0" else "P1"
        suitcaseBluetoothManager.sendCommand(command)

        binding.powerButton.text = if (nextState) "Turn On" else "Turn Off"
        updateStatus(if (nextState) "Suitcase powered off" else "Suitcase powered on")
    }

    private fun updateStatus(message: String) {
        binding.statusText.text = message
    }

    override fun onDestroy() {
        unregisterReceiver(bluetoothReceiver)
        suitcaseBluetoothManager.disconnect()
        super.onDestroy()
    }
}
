package com.example.electricsuitcase

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothSocket
import android.util.Log
import java.io.IOException
import java.io.OutputStream
import java.util.UUID

class SuitcaseBluetoothManager {
    private val bluetoothAdapter: BluetoothAdapter? = BluetoothAdapter.getDefaultAdapter()
    private var socket: BluetoothSocket? = null
    private var outputStream: OutputStream? = null

    companion object {
        private const val TAG = "SuitcaseBluetoothManager"
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }

    fun getPairedDevices(): List<BluetoothDevice> {
        return bluetoothAdapter?.bondedDevices?.toList() ?: emptyList()
    }

    fun isBluetoothEnabled(): Boolean = bluetoothAdapter?.isEnabled == true

    fun connectToDevice(device: BluetoothDevice): Boolean {
        return try {
            disconnect()
            socket = device.createRfcommSocketToServiceRecord(SPP_UUID)
            socket?.connect()
            outputStream = socket?.outputStream
            Log.d(TAG, "Connected to ${device.name}")
            true
        } catch (e: IOException) {
            Log.e(TAG, "Connection failed", e)
            disconnect()
            false
        }
    }

    fun isConnected(): Boolean = socket?.isConnected == true && outputStream != null

    fun sendCommand(command: String): Boolean {
        val stream = outputStream ?: return false
        return try {
            stream.write(command.toByteArray())
            stream.flush()
            true
        } catch (e: IOException) {
            Log.e(TAG, "Failed to send command: $command", e)
            false
        }
    }

    fun disconnect() {
        try {
            outputStream?.close()
        } catch (_: IOException) {
        }

        try {
            socket?.close()
        } catch (_: IOException) {
        }

        outputStream = null
        socket = null
    }
}
