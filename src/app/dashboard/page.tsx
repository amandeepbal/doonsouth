"use client";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";

export default function Dashboard() {
  const [user, setUser] = useState<any>(null);
  const router = useRouter();

  useEffect(() => {
    const checkUser = async () => {
      const { data } = await supabase.auth.getUser();
      if (!data?.user) router.push("/auth");
      setUser(data?.user);
    };
    checkUser();
  }, [router]);

  return user ? <h1>Welcome to Dashboard, {user.email}</h1> : <p>Loading...</p>;
}
