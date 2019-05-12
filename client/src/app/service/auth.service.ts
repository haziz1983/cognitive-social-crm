import { Injectable, Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable()
export class AuthService {
  userState: UserState;
  uri = environment.api_url;
  constructor(private http: HttpClient) {}

  public isAuthenticated(): Observable<any> {
    if (typeof this.userState === 'undefined') {
      return this.checkAuthenticated().do(data => {
        this.userState = data;
      });
    } else {
      return Observable.of(this.userState);
    }
  }

  private isLoggedUrl = this.uri + '/auth/logged';
  checkAuthenticated(): Observable<any> {
    return this.http.get<UserState>(this.isLoggedUrl, {
      withCredentials: true
    });
  }
}

export class UserState {
  logged: boolean;
  loggedInAs: {
    name: string;
    email: string;
  };
}
