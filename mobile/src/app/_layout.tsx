import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { LedgerProvider } from "../LedgerProvider";
export default function Layout() {
  return (
    <SafeAreaProvider>
      <LedgerProvider>
        <Stack screenOptions={{ headerShown: false, animation: "none" }} />
      </LedgerProvider>
    </SafeAreaProvider>
  );
}
