$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
Set-Location $PSScriptRoot
.\gradlew.bat clean assembleDebug
