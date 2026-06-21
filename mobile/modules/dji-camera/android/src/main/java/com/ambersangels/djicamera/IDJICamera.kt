package com.ambersangels.djicamera

import com.facebook.react.bridge.Promise

interface IDJICamera {
    fun initialize(appKey: String, promise: Promise)
    fun isConnected(promise: Promise)
    fun captureFrame(quality: Int, promise: Promise)
    fun getDroneLocation(promise: Promise)
    fun getBatteryLevel(promise: Promise)
    fun getDroneHeading(promise: Promise)
    fun returnToHome(promise: Promise)
    fun startWaypointMission(waypointsJson: String, optionsJson: String, promise: Promise)
    fun stopWaypointMission(promise: Promise)
    fun pauseMission(promise: Promise)
    fun resumeMission(promise: Promise)
    fun getMissionStatus(promise: Promise)
    fun destroy()
}
