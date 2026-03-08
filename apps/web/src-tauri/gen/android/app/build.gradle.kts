import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

fun secret(name: String): String? =
    providers.environmentVariable(name).orNull
        ?: tauriProperties.getProperty(name)

val debugKeystorePath = File(System.getProperty("user.home"), ".android/debug.keystore")
val keystorePath = secret("TAURI_ANDROID_KEYSTORE_PATH") ?: debugKeystorePath.takeIf { it.exists() }?.absolutePath
val keystorePassword = secret("TAURI_ANDROID_KEYSTORE_PASSWORD") ?: "android"
val keyAlias = secret("TAURI_ANDROID_KEY_ALIAS") ?: "androiddebugkey"
val keyPassword = secret("TAURI_ANDROID_KEY_PASSWORD") ?: "android"

android {
    compileSdk = 36
    namespace = "com.offlinefirstbackendsync.epp"
    signingConfigs {
        create("release") {
            check(!keystorePath.isNullOrBlank()) {
                "Missing Android release keystore. Set TAURI_ANDROID_KEYSTORE_PATH (or ensure ~/.android/debug.keystore exists)."
            }

            storeFile = file(keystorePath)
            storePassword = keystorePassword
            this.keyAlias = keyAlias
            this.keyPassword = keyPassword
        }
    }
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.offlinefirstbackendsync.epp"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")
